const DAY_MS = 24 * 60 * 60 * 1000;

export const normalizeAnalyticsName = (value) => String(value || '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const getAnalyticsDate = (record) => record?.date || record?.movement_at || record?.created || '';

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getAgeInDays = (value, now) => {
  const timestamp = new Date(value || '').getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / DAY_MS)) : null;
};

const isCreditInvoice = (invoice) => ['credit', 'آجل', 'اجل'].includes(
  String(invoice?.payment_type || invoice?.payment_method || invoice?.type || '').trim().toLowerCase(),
);

const isReturnedInvoice = (invoice) => String(invoice?.status || '').includes('مرتجع');

const getMonthWindow = (date, offset = 0) => {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1);
  return { start: start.getTime(), end: end.getTime() };
};

const isInWindow = (record, window) => {
  const timestamp = new Date(getAnalyticsDate(record)).getTime();
  return Number.isFinite(timestamp) && timestamp >= window.start && timestamp < window.end;
};

export function buildProductAnalytics({ recipes, materials, invoices, now = new Date(), periodDays = 90 }) {
  const nowTime = now.getTime();
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const recipesByProduct = new Map();

  recipes.forEach((recipe) => {
    const name = normalizeAnalyticsName(recipe.product_name || recipe.name || recipe.product);
    if (!name) return;
    const rows = recipesByProduct.get(name) || [];
    rows.push(recipe);
    recipesByProduct.set(name, rows);
  });

  const salesByProduct = new Map();
  invoices.forEach((invoice) => {
    if (isReturnedInvoice(invoice)) return;
    const timestamp = new Date(getAnalyticsDate(invoice)).getTime();
    if (!Number.isFinite(timestamp) || timestamp < nowTime - periodDays * DAY_MS || timestamp > nowTime) return;

    (Array.isArray(invoice.items) ? invoice.items : []).forEach((item) => {
      if (item.itemType === 'material') return;
      const name = normalizeAnalyticsName(item.name || item.product_name);
      const quantity = toNumber(item.qty);
      const price = toNumber(item.price);
      if (!name || quantity <= 0 || price <= 0) return;
      const rows = salesByProduct.get(name) || [];
      rows.push({ invoiceId: invoice.id, timestamp, quantity, price });
      salesByProduct.set(name, rows);
    });
  });

  return [...new Set([...recipesByProduct.keys(), ...salesByProduct.keys()])]
    .map((name) => {
      const productRecipes = recipesByProduct.get(name) || [];
      const observationsByInvoice = new Map();
      (salesByProduct.get(name) || []).forEach((sale) => {
        const existing = observationsByInvoice.get(sale.invoiceId) || { quantity: 0, value: 0, timestamp: sale.timestamp };
        existing.quantity += sale.quantity;
        existing.value += sale.quantity * sale.price;
        observationsByInvoice.set(sale.invoiceId, existing);
      });

      const observations = [...observationsByInvoice.values()].map((sale) => ({
        quantity: sale.quantity,
        price: sale.value / sale.quantity,
        timestamp: sale.timestamp,
      }));
      const salesQuantity = observations.reduce((sum, sale) => sum + sale.quantity, 0);
      const historicalPrice = salesQuantity > 0
        ? observations.reduce((sum, sale) => sum + sale.quantity * sale.price, 0) / salesQuantity
        : 0;
      const firstRecipe = productRecipes[0] || {};
      const currentPrice = toNumber(firstRecipe.selling_price ?? firstRecipe.sellingPrice ?? firstRecipe.price) || historicalPrice;
      const otherCost = toNumber(firstRecipe.other_cost ?? firstRecipe.otherCost);
      const ingredients = productRecipes.map((recipe) => {
        const materialId = recipe.raw_material_id || recipe.material_id;
        const material = materialById.get(materialId);
        const rawPrice = material?.price ?? material?.cost ?? material?.purchase_price;
        return {
          materialId,
          materialName: material?.name || recipe.material_name || 'خامة غير مرتبطة',
          quantityPerTon: toNumber(recipe.quantity_needed ?? recipe.qtyNeeded ?? recipe.quantity),
          unitPrice: toNumber(rawPrice),
          hasPrice: Boolean(material) && rawPrice !== undefined && rawPrice !== null && Number.isFinite(Number(rawPrice)),
        };
      });
      const unitCost = ingredients.reduce((sum, ingredient) => sum + ingredient.quantityPerTon * ingredient.unitPrice, otherCost);
      const hasCostData = productRecipes.length > 0 && ingredients.length > 0 && ingredients.every((ingredient) => ingredient.hasPrice);
      const distinctPrices = new Set(observations.map((sale) => sale.price.toFixed(2))).size;
      const logPoints = observations.filter((sale) => sale.quantity > 0 && sale.price > 0)
        .map((sale) => ({ x: Math.log(sale.price), y: Math.log(sale.quantity) }));
      const meanX = logPoints.reduce((sum, point) => sum + point.x, 0) / Math.max(logPoints.length, 1);
      const meanY = logPoints.reduce((sum, point) => sum + point.y, 0) / Math.max(logPoints.length, 1);
      const varianceX = logPoints.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
      const covariance = logPoints.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
      const elasticity = logPoints.length >= 3 && distinctPrices >= 2 && varianceX > 0
        ? covariance / varianceX
        : null;
      const baselineDailyDemand = salesQuantity / periodDays;
      const canOptimize = hasCostData && elasticity !== null && elasticity < -1 && currentPrice > unitCost && unitCost >= 0;
      const theoreticalOptimalPrice = canOptimize ? (elasticity / (elasticity + 1)) * unitCost : null;
      const optimalPrice = theoreticalOptimalPrice === null
        ? null
        : Math.max(unitCost * 1.001, theoreticalOptimalPrice);
      const profitAt = (price) => {
        if (!elasticity || currentPrice <= 0 || price <= unitCost) return 0;
        return (price - unitCost) * baselineDailyDemand * (price / currentPrice) ** elasticity;
      };

      return {
        name: productRecipes[0]?.product_name || productRecipes[0]?.name || name,
        currentPrice,
        unitCost,
        margin: currentPrice - unitCost,
        marginPercent: currentPrice > 0 ? ((currentPrice - unitCost) / currentPrice) * 100 : 0,
        observations: observations.length,
        distinctPrices,
        salesQuantity,
        elasticity,
        optimalPrice,
        profitAtCurrentDaily: profitAt(currentPrice),
        profitAtOptimalDaily: optimalPrice === null ? null : profitAt(optimalPrice),
        ingredients,
        hasRecipe: productRecipes.length > 0,
        hasCostData,
      };
    })
    .sort((first, second) => second.salesQuantity - first.salesQuantity);
}

export function buildMaterialScenario(products, materialId, changePercent) {
  const change = Math.max(-100, toNumber(changePercent)) / 100;
  return products.map((product) => {
    const affectedCost = product.ingredients
      .filter((ingredient) => ingredient.materialId === materialId)
      .reduce((sum, ingredient) => sum + ingredient.quantityPerTon * ingredient.unitPrice, 0);
    const addedCost = affectedCost * change;
    const projectedCost = product.unitCost + addedCost;
    return {
      ...product,
      affectedCost,
      addedCost,
      projectedCost,
      projectedMargin: product.currentPrice - projectedCost,
      breakEvenPrice: projectedCost,
      requiredPriceForCurrentMargin: product.currentPrice + addedCost,
    };
  }).filter((product) => product.hasCostData && product.affectedCost > 0);
}

export function buildCreditAnalytics({ clients, invoices, transactions, now = new Date(), periodDays = 90 }) {
  const nowTime = now.getTime();
  const clientRows = clients.map((client) => {
    const clientInvoices = invoices
      .filter((invoice) => !isReturnedInvoice(invoice) && isCreditInvoice(invoice)
        && (String(invoice.customer_id || '') === String(client.id) || normalizeAnalyticsName(invoice.customer_name) === normalizeAnalyticsName(client.name)))
      .sort((first, second) => new Date(getAnalyticsDate(first)).getTime() - new Date(getAnalyticsDate(second)).getTime());
    const debt = Math.max(0, toNumber(client.balance ?? client.debt ?? client.total_debt));
    let unallocatedDebt = debt;
    const aging = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };

    [...clientInvoices].reverse().forEach((invoice) => {
      const outstanding = Math.min(unallocatedDebt, Math.max(0, toNumber(invoice.total_amount)));
      unallocatedDebt -= outstanding;
      const age = getAgeInDays(getAnalyticsDate(invoice), nowTime);
      if (age === null) return;
      if (age <= 30) aging.current += outstanding;
      else if (age <= 60) aging.days31to60 += outstanding;
      else if (age <= 90) aging.days61to90 += outstanding;
      else aging.over90 += outstanding;
    });
    aging.over90 += unallocatedDebt;

    const payments = transactions
      .filter((transaction) => transaction.client_id === client.id && String(transaction.type || '').toLowerCase() === 'payment')
      .sort((first, second) => new Date(getAnalyticsDate(second)).getTime() - new Date(getAnalyticsDate(first)).getTime());
    const lastPaymentDate = payments[0] ? getAnalyticsDate(payments[0]) : '';
    const daysSincePayment = lastPaymentDate ? getAgeInDays(lastPaymentDate, nowTime) : null;
    const agedShare = debt > 0 ? (aging.days31to60 + aging.days61to90 + aging.over90) / debt : 0;
    const recencyRisk = debt > 0 ? Math.min(30, (daysSincePayment ?? 30) / 3) : 0;
    const riskScore = Math.min(100, Math.round(agedShare * 70 + recencyRisk));
    const riskLabel = debt <= 0 ? 'منتظم' : riskScore >= 70 ? 'مرتفع' : riskScore >= 35 ? 'متوسط' : 'منخفض';

    return { id: client.id, name: client.name || 'عميل بدون اسم', debt, aging, daysSincePayment, riskScore, riskLabel };
  }).filter((client) => client.debt > 0).sort((first, second) => second.riskScore - first.riskScore || second.debt - first.debt);

  const totalReceivables = clientRows.reduce((sum, client) => sum + client.debt, 0);
  const creditSales = invoices.filter((invoice) => !isReturnedInvoice(invoice) && isCreditInvoice(invoice))
    .filter((invoice) => {
      const timestamp = new Date(getAnalyticsDate(invoice)).getTime();
      return Number.isFinite(timestamp) && timestamp >= nowTime - periodDays * DAY_MS && timestamp <= nowTime;
    })
    .reduce((sum, invoice) => sum + toNumber(invoice.total_amount), 0);
  const dso = creditSales > 0 ? (totalReceivables / creditSales) * periodDays : null;
  const paymentDelays = clientRows.map((client) => client.daysSincePayment).filter((days) => days !== null);
  const averageCollectionGap = paymentDelays.length
    ? paymentDelays.reduce((sum, days) => sum + days, 0) / paymentDelays.length
    : null;

  return { clients: clientRows, totalReceivables, creditSales, dso, averageCollectionGap };
}

export function buildCashForecast({ treasury, invoices, clientTransactions, supplierTransactions, expenses, salaryPayouts, now = new Date(), historyDays = 90 }) {
  const nowTime = now.getTime();
  const periodStart = nowTime - historyDays * DAY_MS;
  const isInPeriod = (record) => {
    const timestamp = new Date(getAnalyticsDate(record)).getTime();
    return Number.isFinite(timestamp) && timestamp >= periodStart && timestamp <= nowTime;
  };
  const isTreasuryDestination = (record) => ['treasury', 'خزنة', 'كاش', ''].includes(String(record.destination || record.payment_source || '').trim().toLowerCase());
  const cashSales = invoices.filter((invoice) => isInPeriod(invoice) && !isReturnedInvoice(invoice)
    && !isCreditInvoice(invoice) && !['bank', 'banks'].includes(String(invoice.payment_source || '').toLowerCase()))
    .reduce((sum, invoice) => sum + toNumber(invoice.total_amount), 0);
  const collections = clientTransactions.filter((transaction) => isInPeriod(transaction)
    && transaction.type === 'payment' && isTreasuryDestination(transaction))
    .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);
  const supplierPayments = supplierTransactions.filter((transaction) => isInPeriod(transaction)
    && !String(transaction.type || '').toLowerCase().includes('open') && isTreasuryDestination(transaction))
    .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);
  const treasuryExpenses = expenses.filter((expense) => isInPeriod(expense)
    && !expense.bank_id && String(expense.payment_source || 'treasury').toLowerCase() !== 'bank')
    .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
  const salaryPayments = salaryPayouts.filter(isInPeriod)
    .reduce((sum, salary) => sum + toNumber(salary.amount ?? salary.total_amount ?? salary.net_salary), 0);
  const dailyInflow = (cashSales + collections) / historyDays;
  const dailyOutflow = (supplierPayments + treasuryExpenses + salaryPayments) / historyDays;
  const currentBalance = toNumber(treasury?.balance ?? treasury?.opening_balance);
  const projectedInflows = dailyInflow * 30;
  const projectedOutflows = dailyOutflow * 30;
  const projectedBalance = currentBalance + projectedInflows - projectedOutflows;
  const dailyNetBurn = Math.max(0, dailyOutflow - dailyInflow);

  return {
    currentBalance,
    projectedInflows,
    projectedOutflows,
    projectedBalance,
    projectedShortfall: Math.max(0, -projectedBalance),
    estimatedDaysToShortfall: dailyNetBurn > 0 && currentBalance > 0 ? Math.ceil(currentBalance / dailyNetBurn) : null,
  };
}

export function buildRecipeVariance({ recipes, materials, productionOrders, adjustments, now = new Date(), periodDays = 90 }) {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const recipesByProduct = new Map();
  recipes.forEach((recipe) => {
    const name = normalizeAnalyticsName(recipe.product_name || recipe.name || recipe.product);
    const rows = recipesByProduct.get(name) || [];
    rows.push(recipe);
    recipesByProduct.set(name, rows);
  });
  const lowerTime = now.getTime() - periodDays * DAY_MS;
  const eligibleOrders = productionOrders.filter((order) => {
    const timestamp = new Date(getAnalyticsDate(order)).getTime();
    return Number.isFinite(timestamp) && timestamp >= lowerTime && timestamp <= now.getTime();
  });
  const consumedAdjustments = adjustments.filter((adjustment) => (
    adjustment.source_type === 'production_order' || String(adjustment.reason || '').includes('استهلاك في أمر تصنيع')
  ));
  const assigned = new Map(eligibleOrders.map((order) => [order.id, []]));

  consumedAdjustments.forEach((adjustment) => {
    const productName = normalizeAnalyticsName(adjustment.production_order || adjustment.production_order_name || adjustment.source_order_name);
    const adjustmentDate = new Date(getAnalyticsDate(adjustment)).getTime();
    const candidates = eligibleOrders.filter((order) => {
      if (normalizeAnalyticsName(order.product_name || order.name) !== productName) return false;
      const orderDate = new Date(getAnalyticsDate(order)).getTime();
      if (!Number.isFinite(adjustmentDate) || !Number.isFinite(orderDate)) return false;
      return Math.abs(orderDate - adjustmentDate) <= DAY_MS;
    });
    if (!candidates.length) return;
    const recordedQuantity = toNumber(adjustment.production_order_quantity);
    candidates.sort((first, second) => {
      const firstBatch = toNumber(first.batch_quantity ?? first.quantity);
      const secondBatch = toNumber(second.batch_quantity ?? second.quantity);
      const firstMismatch = recordedQuantity > 0 && Math.abs(firstBatch - recordedQuantity) > 0.001 ? 1 : 0;
      const secondMismatch = recordedQuantity > 0 && Math.abs(secondBatch - recordedQuantity) > 0.001 ? 1 : 0;
      if (firstMismatch !== secondMismatch) return firstMismatch - secondMismatch;
      const firstDistance = Math.abs(new Date(getAnalyticsDate(first)).getTime() - adjustmentDate);
      const secondDistance = Math.abs(new Date(getAnalyticsDate(second)).getTime() - adjustmentDate);
      return firstDistance - secondDistance;
    });
    assigned.get(candidates[0].id).push(adjustment);
  });

  const orderRows = eligibleOrders.flatMap((order) => {
    const actualRows = assigned.get(order.id) || [];
    const productName = normalizeAnalyticsName(order.product_name || order.name);
    const productRecipes = recipesByProduct.get(productName) || [];
    if (!actualRows.length || !productRecipes.length) return [];
    const quantityProduced = toNumber(order.batch_quantity ?? order.quantity);
    const actualByMaterial = new Map();
    actualRows.forEach((adjustment) => {
      const materialId = adjustment.material_id;
      actualByMaterial.set(materialId, (actualByMaterial.get(materialId) || 0) + Math.abs(toNumber(adjustment.quantity)));
    });
    const recipeByMaterial = new Map();
    productRecipes.forEach((recipe) => {
      const materialId = recipe.raw_material_id || recipe.material_id;
      recipeByMaterial.set(materialId, (recipeByMaterial.get(materialId) || 0) + toNumber(recipe.quantity_needed ?? recipe.qtyNeeded ?? recipe.quantity) * quantityProduced);
    });
    const materialIds = new Set([...recipeByMaterial.keys(), ...actualByMaterial.keys()]);
    return [...materialIds].map((materialId) => {
      const material = materialById.get(materialId);
      const theoretical = recipeByMaterial.get(materialId) || 0;
      const actual = actualByMaterial.get(materialId) || 0;
      return {
        orderId: order.id,
        date: getAnalyticsDate(order),
        productName: order.product_name || order.name || 'منتج غير معروف',
        materialName: material?.name || actualRows.find((row) => row.material_id === materialId)?.material_name || 'خامة غير مرتبطة',
        producedQuantity: quantityProduced,
        theoretical,
        actual,
        variance: actual - theoretical,
        variancePercent: theoretical > 0 ? ((actual - theoretical) / theoretical) * 100 : (actual > 0 ? 100 : 0),
      };
    });
  });

  return orderRows.reduce((summary, row) => {
    const key = normalizeAnalyticsName(row.materialName);
    const existing = summary.get(key) || { materialName: row.materialName, theoretical: 0, actual: 0, variance: 0, orderCount: new Set() };
    existing.theoretical += row.theoretical;
    existing.actual += row.actual;
    existing.variance += row.variance;
    existing.orderCount.add(row.orderId);
    summary.set(key, existing);
    return summary;
  }, new Map());
}

export function buildMonthlyFactoryPerformance({ recipes, materials, invoices, expenses, salaryPayouts, now = new Date() }) {
  const products = buildProductAnalytics({ recipes, materials, invoices, now, periodDays: 10_000 });
  const productByName = new Map(products.map((product) => [normalizeAnalyticsName(product.name), product]));
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const currentWindow = getMonthWindow(now);
  const previousWindow = getMonthWindow(now, -1);

  const summarize = (window) => {
    const periodInvoices = invoices.filter((invoice) => isInWindow(invoice, window) && !isReturnedInvoice(invoice));
    const periodExpenses = expenses.filter((expense) => isInWindow(expense, window));
    const periodSalaries = salaryPayouts.filter((salary) => isInWindow(salary, window));
    const sales = periodInvoices.reduce((sum, invoice) => sum + toNumber(invoice.total_amount ?? invoice.amount), 0);
    const productRows = new Map();

    periodInvoices.forEach((invoice) => {
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      const itemSales = items.reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.qty), 0);
      const discount = toNumber(invoice.discount ?? invoice.discount_amount);
      items.forEach((item) => {
        const isMaterial = item.itemType === 'material';
        const displayName = item.name || item.product_name || 'منتج غير معروف';
        const rawName = normalizeAnalyticsName(displayName);
        const name = isMaterial ? `material:${item.materialId || item.material_id || rawName}` : rawName;
        const quantity = toNumber(item.qty);
        const grossLine = toNumber(item.price) * quantity;
        const netRevenue = grossLine - (itemSales > 0 ? discount * grossLine / itemSales : 0);
        const product = productByName.get(name);
        const matchingMaterial = isMaterial
          ? materialById.get(item.materialId || item.material_id) || materials.find((material) => normalizeAnalyticsName(material.name || material.material_name) === rawName)
          : null;
        const materialPrice = matchingMaterial?.price ?? matchingMaterial?.cost ?? matchingMaterial?.purchase_price;
        const hasCostData = isMaterial
          ? Boolean(matchingMaterial) && materialPrice !== undefined && materialPrice !== null && Number.isFinite(Number(materialPrice))
          : Boolean(product?.hasCostData);
        const unitCost = isMaterial ? toNumber(materialPrice) : toNumber(product?.unitCost);
        const row = productRows.get(name) || {
          name: isMaterial ? `خامة · ${displayName}` : product?.name || displayName,
          revenue: 0,
          quantity: 0,
          estimatedMaterialCost: 0,
          hasCostData,
        };
        row.revenue += netRevenue;
        row.quantity += quantity;
        row.hasCostData = row.hasCostData && hasCostData;
        if (hasCostData) row.estimatedMaterialCost += unitCost * quantity;
        productRows.set(name, row);
      });
    });

    const expenseCategories = new Map();
    periodExpenses.forEach((expense) => {
      const category = expense.expand?.category_id?.name || expense.category_name || 'مصروف غير مصنف';
      const existing = expenseCategories.get(category) || { name: category, amount: 0 };
      existing.amount += toNumber(expense.amount);
      expenseCategories.set(category, existing);
    });
    const expenseAmount = periodExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const salaryAmount = periodSalaries.reduce((sum, salary) => sum + toNumber(salary.amount ?? salary.total_amount ?? salary.net_salary), 0);
    if (salaryAmount > 0) expenseCategories.set('رواتب', { name: 'رواتب', amount: salaryAmount });
    const knownProducts = [...productRows.values()].filter((product) => product.hasCostData);
    const knownRevenue = knownProducts.reduce((sum, product) => sum + product.revenue, 0);
    const salesMaterialCost = knownProducts.reduce((sum, product) => sum + product.estimatedMaterialCost, 0);
    const itemRevenue = [...productRows.values()].reduce((sum, product) => sum + product.revenue, 0);
    const grossContribution = knownProducts.reduce((sum, product) => sum + product.revenue - product.estimatedMaterialCost, 0);
    const allocatedOverhead = expenseAmount + salaryAmount;
    const estimatedNetProfit = grossContribution - allocatedOverhead;
    const rankedProducts = knownProducts.map((product) => {
      const share = knownRevenue > 0 ? product.revenue / knownRevenue : 0;
      const allocatedExpenses = allocatedOverhead * share;
      const grossContribution = product.revenue - product.estimatedMaterialCost;
      const netContribution = product.revenue - product.estimatedMaterialCost - allocatedExpenses;
      return {
        ...product,
        grossContribution,
        allocatedExpenses,
        netContribution,
        grossProfitPercent: product.estimatedMaterialCost > 0
          ? (grossContribution / product.estimatedMaterialCost) * 100
          : null,
        netProfitPercent: product.estimatedMaterialCost > 0
          ? (netContribution / product.estimatedMaterialCost) * 100
          : null,
        profitShare: estimatedNetProfit > 0 ? netContribution / estimatedNetProfit * 100 : null,
      };
    }).sort((first, second) => second.netContribution - first.netContribution);

    return {
      sales,
      salesMaterialCost,
      grossContribution,
      expenseAmount,
      salaryAmount,
      allOverhead: allocatedOverhead,
      expenseRatio: sales > 0 ? (allocatedOverhead / sales) * 100 : null,
      estimatedNetProfit,
      productCostCoverage: itemRevenue > 0 ? (knownRevenue / itemRevenue) * 100 : 0,
      uncostedProductCount: productRows.size - knownProducts.length,
      topExpense: [...expenseCategories.values()].sort((first, second) => second.amount - first.amount)[0] || null,
      expenseCategories: [...expenseCategories.values()].sort((first, second) => second.amount - first.amount),
      rankedProducts,
    };
  };

  return { current: summarize(currentWindow), previous: summarize(previousWindow) };
}

export function buildPromotionSuggestions({ productsStock, recipes, materials, invoices, clients, clientsAnalytics = [], now = new Date(), periodDays = 90 }) {
  const productAnalytics = buildProductAnalytics({ recipes, materials, invoices, now, periodDays });
  const productsByName = new Map(productAnalytics.map((product) => [normalizeAnalyticsName(product.name), product]));
  const nowTime = now.getTime();
  const lowerTime = nowTime - periodDays * DAY_MS;
  const recentBuyers = new Map();

  invoices.filter((invoice) => !isReturnedInvoice(invoice)).forEach((invoice) => {
    const timestamp = new Date(getAnalyticsDate(invoice)).getTime();
    if (!Number.isFinite(timestamp) || timestamp < lowerTime || timestamp > nowTime) return;
    (Array.isArray(invoice.items) ? invoice.items : []).forEach((item) => {
      if (item.itemType === 'material') return;
      const key = normalizeAnalyticsName(item.name || item.product_name);
      const buyers = recentBuyers.get(key) || new Map();
      const clientName = normalizeAnalyticsName(invoice.customer_name);
      if (clientName) buyers.set(clientName, { name: invoice.customer_name, lastBought: timestamp });
      recentBuyers.set(key, buyers);
    });
  });

  const debtByClient = new Map(clients.map((client) => [normalizeAnalyticsName(client.name), toNumber(client.balance ?? client.debt ?? client.total_debt)]));
  const creditRiskByClient = new Map(clientsAnalytics.map((client) => [normalizeAnalyticsName(client.name), client.riskScore]));

  return productsStock.flatMap((stockRecord) => {
    const name = stockRecord.product_name || stockRecord.name || '';
    const product = productsByName.get(normalizeAnalyticsName(name));
    const stock = Math.max(0, toNumber(stockRecord.stock ?? stockRecord.quantity));
    if (!name || !product?.hasCostData || stock <= 0 || product.currentPrice <= product.unitCost) return [];

    const sales = invoices.filter((invoice) => !isReturnedInvoice(invoice))
      .flatMap((invoice) => (Array.isArray(invoice.items) ? invoice.items : [])
        .filter((item) => normalizeAnalyticsName(item.name || item.product_name) === normalizeAnalyticsName(name))
        .map((item) => ({ timestamp: new Date(getAnalyticsDate(invoice)).getTime(), quantity: toNumber(item.qty) })))
      .filter((sale) => Number.isFinite(sale.timestamp) && sale.timestamp >= lowerTime && sale.timestamp <= nowTime);
    const recentSold = sales.filter((sale) => sale.timestamp >= nowTime - 30 * DAY_MS)
      .reduce((sum, sale) => sum + sale.quantity, 0);
    const totalSold = sales.reduce((sum, sale) => sum + sale.quantity, 0);
    const dailyDemand = totalSold / periodDays;
    const daysOfStock = dailyDemand > 0 ? stock / dailyDemand : Infinity;
    const isIdle = recentSold === 0;
    if (!isIdle && daysOfStock < 60) return [];

    const safetyFloor = Math.max(100, product.currentPrice * 0.05);
    const safeDiscount = Math.max(0, product.currentPrice - product.unitCost - safetyFloor);
    if (safeDiscount < 1) return [];
    const suggestedDiscount = Math.min(safeDiscount, product.currentPrice * (isIdle || daysOfStock >= 120 ? 0.05 : 0.03));
    const targetCustomers = [...(recentBuyers.get(normalizeAnalyticsName(name))?.values() || [])]
      .filter((buyer) => (
        (debtByClient.get(normalizeAnalyticsName(buyer.name)) || 0) <= product.currentPrice * 2 &&
        (creditRiskByClient.get(normalizeAnalyticsName(buyer.name)) ?? 0) < 70
      ))
      .sort((first, second) => second.lastBought - first.lastBought)
      .slice(0, 3)
      .map((buyer) => buyer.name);

    return [{
      name,
      stock,
      daysOfStock,
      frozenCapital: stock * product.unitCost,
      suggestedDiscount,
      suggestedPrice: product.currentPrice - suggestedDiscount,
      safetyMargin: product.currentPrice - suggestedDiscount - product.unitCost,
      reason: isIdle ? 'لا توجد مبيعات خلال آخر 30 يومًا' : `مخزون يكفي قرابة ${Math.round(daysOfStock)} يومًا`,
      recommendedWhen: isIdle ? 'ابدأ خلال 7 أيام' : 'ابدأ خلال 14 يومًا',
      targetCustomers,
    }];
  }).sort((first, second) => second.frozenCapital - first.frozenCapital);
}
