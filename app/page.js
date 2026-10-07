import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="-m-6 min-h-[calc(100vh-3rem)] w-[calc(100%+3rem)] bg-[#f8f5ed] text-[#142c45]" dir="rtl">
      <header className="relative z-10 flex min-h-[76px] items-center justify-between gap-3 border-b border-[#142c451f] bg-[#f8f5ed] px-5 py-3 sm:px-8 lg:px-20">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[15px] font-bold text-[#142c45] no-underline sm:text-[17px]" aria-label="أعلاف الزعيم - الرئيسية">
          <Image src="/elzaem.jpg" alt="شعار مصنع أعلاف الزعيم" width={50} height={50} className="h-10 w-10 rounded-full border border-white bg-white object-contain shadow-md ring-1 ring-[#142c4529] sm:h-12 sm:w-12" priority />
          <span>أعلاف <b className="text-[#b84335]">الزعيم</b></span>
        </Link>
        <nav className="hidden items-center gap-8 text-[13px] font-semibold text-[#29445e] sm:flex" aria-label="التنقل الرئيسي">
          <a className="transition-colors hover:text-[#b84335]" href="#products">منتجاتنا</a>
          <a className="transition-colors hover:text-[#b84335]" href="#care">نصائح التربية</a>
          <a className="transition-colors hover:text-[#b84335]" href="#about">عن المصنع</a>
          <a className="transition-colors hover:text-[#b84335]" href="#contact">التواصل</a>
        </nav>
        <Link href="/moashe" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-sm border border-[#142c453d] px-3 text-[11px] font-bold text-[#29445e] transition-colors hover:border-[#b84335] hover:text-[#b84335] sm:px-4 sm:text-[13px]">
          دخول النظام <span className="text-base text-[#b84335]" aria-hidden="true">←</span>
        </Link>
      </header>

      <main>
        <section className="relative grid min-h-[650px] grid-cols-1 items-center gap-10 overflow-hidden bg-[linear-gradient(135deg,#faf8f1_0%,#f4eedf_100%)] px-6 py-14 sm:px-10 lg:min-h-[min(720px,calc(100vh-76px))] lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-28 lg:py-16">
          <div className="relative z-[1] max-w-2xl">
            <p className="mb-5 flex items-center gap-2.5 text-xs font-extrabold text-[#b84335]"><span className="h-0.5 w-6 bg-[#d7ad55]" /> خبرة تُترجم إلى عناية يومية</p>
            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
              <h1 className="m-0 text-[clamp(2.8rem,7vw,6.5rem)] font-black leading-[1.08] text-[#142c45]">أعلاف الزعيم</h1>
              <div className="relative h-44 w-44 rounded-full shadow-[0_10px_28px_rgba(20,44,69,0.3)]">
                <Image src="/elzaem.jpg" alt="شعار أعلاف الزعيم" fill className="rounded-full object-cover" />
              </div>
            </div>
            <p className="mt-4 max-w-xl text-[clamp(1.25rem,2.4vw,1.95rem)] font-extrabold leading-relaxed text-[#b84335]">تغذية مدروسة، من أول يوم لحد تمام الدورة.</p>
            <p className="mt-4 max-w-lg text-sm leading-8 text-[#586575] sm:text-[15px]">
              نوفر أعلافًا لمراحل التربية المختلفة، باهتمام يبدأ من اختيار الخلطة المناسبة ويمتد إلى احتياجات المربي في كل يوم.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#products" className="inline-flex min-h-12 items-center justify-center gap-5 rounded-sm border border-[#142c45] bg-[#142c45] px-5 text-[13px] font-bold text-white no-underline transition hover:-translate-y-0.5 hover:border-[#b84335] hover:bg-[#b84335]">اكتشف المنتجات <span aria-hidden="true">↓</span></a>
              <Link href="/login" className="inline-flex min-h-12 items-center justify-center gap-5 rounded-sm border border-[#142c45] bg-transparent px-5 text-[13px] font-bold text-[#142c45] no-underline transition hover:-translate-y-0.5 hover:bg-[#142c45] hover:text-white">بوابة العملاء <span aria-hidden="true">↗</span></Link>
            </div>
            <div className="mt-6 inline-flex max-w-full items-center gap-4 rounded-2xl border border-[#142c4517] border-l-4 border-l-[#d7ad55] bg-white/85 px-4 py-3 shadow-[0_8px_24px_rgba(20,44,69,0.09)] sm:gap-5 sm:px-5" dir="ltr">
              <Image src="/mohamed.jpeg" alt="Mohamed Ibrahim" width={96} height={96} className="h-20 w-20 shrink-0 rounded-full border-2 border-white object-cover shadow-[0_4px_14px_rgba(20,44,69,0.25)] ring-1 ring-[#d7ad55] sm:h-24 sm:w-24" />
              <div className="text-left">
                <p className="m-0 text-[9px] font-bold tracking-[0.08em] text-[#718091] sm:text-[10px]">THIS WEBSITE CREATED BY</p>
                <p className="mb-0 mt-1 text-sm font-black text-[#142c45] sm:text-base">MOHAMED IBRAHEM</p>
              </div>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-3 text-[11px] font-bold text-[#77796f]">
              <span>بادئ</span><i className="h-1 w-1 rounded-full bg-[#d7ad55]" /> <span>نامي</span><i className="h-1 w-1 rounded-full bg-[#d7ad55]" /> <span>ناهي</span><i className="h-1 w-1 rounded-full bg-[#d7ad55]" /> <span>تربية منزلية</span>
            </div>
          </div>

          <div className="relative mx-auto flex w-[88%] max-w-[540px] flex-col items-center justify-center sm:w-[76%] lg:w-full" aria-label="مصنع أعلاف الزعيم">
            <div className="absolute -right-5 top-[5%] z-[1] bg-[#b84335] px-3.5 py-2.5 text-[11px] font-extrabold text-[#fffdf8] sm:-right-7">من أرضنا.. لغذاءٍ أفضل</div>
            <div className="relative aspect-[4/3] rounded-2xl w-full overflow-hidden border border-[#142c4533] bg-[#142c45] shadow-[16px_16px_0_#eadbb7]">
              <Image src="/factory.jpg" alt="صورة لمصنع أعلاف" fill priority sizes="(max-width: 760px) 88vw, 42vw" className="object-cover  brightness-110 contrast-105" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0e2237]/80 via-[#0e2237]/25 to-transparent px-4 pb-4 pt-16 text-xs font-bold text-white sm:px-6 sm:pb-6">مصنع أعلاف الزعيم</div>
            </div>
            <div className="mt-5 flex w-full justify-between text-[11px] font-bold text-[#6d7580]"><span className="text-[#b84335]">01</span><span>رعاية تبدأ من العلف</span></div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-8 bg-[#142c45] px-6 py-16 text-[#fffdf8] sm:px-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-28 lg:px-36 lg:py-24" id="products">
          <div>
            <p className="mb-5 flex items-center gap-2.5 text-xs font-extrabold text-[#d7ad55]"><span className="h-0.5 w-6 bg-[#d7ad55]" /> اختيار لكل مرحلة</p>
            <h2 className="m-0 text-[clamp(1.9rem,4vw,3.1rem)] font-extrabold leading-[1.45]">من بداية التربية<br />حتى اكتمال النمو</h2>
          </div>
          <div>
            <article className="grid min-h-[90px] grid-cols-[34px_1fr_24px] items-center gap-3 border-b border-white/20 sm:grid-cols-[42px_1fr_24px] sm:gap-4">
              <span className="text-[11px] font-extrabold text-[#d7ad55]">01</span>
              <div><h3 className="m-0 text-lg font-extrabold">علف بادي</h3><p className="mt-1.5 text-xs leading-6 text-white/65">للمرحلة الأولى وبداية الرعاية.</p></div>
              <span className="text-xl text-[#d7ad55]" aria-hidden="true">↙</span>
            </article>
            <article className="grid min-h-[90px] grid-cols-[34px_1fr_24px] items-center gap-3 border-b border-white/20 sm:grid-cols-[42px_1fr_24px] sm:gap-4">
              <span className="text-[11px] font-extrabold text-[#d7ad55]">02</span>
              <div><h3 className="m-0 text-lg font-extrabold">علف نامي</h3><p className="mt-1.5 text-xs leading-6 text-white/65">للاحتياجات المتغيرة خلال النمو.</p></div>
              <span className="text-xl text-[#d7ad55]" aria-hidden="true">↙</span>
            </article>
            <article className="grid min-h-[90px] grid-cols-[34px_1fr_24px] items-center gap-3 border-b border-white/20 sm:grid-cols-[42px_1fr_24px] sm:gap-4">
              <span className="text-[11px] font-extrabold text-[#d7ad55]">03</span>
              <div><h3 className="m-0 text-lg font-extrabold">علف ناهي</h3><p className="mt-1.5 text-xs leading-6 text-white/65">للانتقال إلى المرحلة الأخيرة من الدورة.</p></div>
              <span className="text-xl text-[#d7ad55]" aria-hidden="true">↙</span>
            </article>
            <article className="grid min-h-[90px] grid-cols-[34px_1fr_24px] items-center gap-3 border-b border-white/20 sm:grid-cols-[42px_1fr_24px] sm:gap-4">
              <span className="text-[11px] font-extrabold text-[#d7ad55]">04</span>
              <div><h3 className="m-0 text-lg font-extrabold">تربية منزلية</h3><p className="mt-1.5 text-xs leading-6 text-white/65">خيارات تناسب احتياجات التربية المنزلية.</p></div>
              <span className="text-xl text-[#d7ad55]" aria-hidden="true">↙</span>
            </article>
          </div>
        </section>

        <section className="grid grid-cols-1 items-center gap-10 bg-[#f8f5ed] px-6 py-16 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:px-36 lg:py-24" id="care">
          <div>
            <p className="mb-5 flex items-center gap-2.5 text-xs font-extrabold text-[#b84335]"><span className="h-0.5 w-6 bg-[#d7ad55]" /> رعاية يومية أفضل</p>
            <h2 className="m-0 max-w-xl text-[clamp(1.9rem,4vw,3rem)] font-extrabold leading-[1.4] text-[#142c45]">نصائح بسيطة،<br />تفرق في دورة التربية.</h2>
            <p className="mt-4 max-w-xl text-sm leading-8 text-[#586575]">أساسيات تساعد على تهيئة بيئة مناسبة للقطيع. اتبع دائمًا إرشادات المختص وتعليمات المنتج.</p>

            <div className="mt-7">
              <article className="grid grid-cols-[36px_1fr] gap-3 border-t border-[#142c4522] py-4 sm:grid-cols-[44px_1fr]">
                <span className="pt-1 text-[11px] font-extrabold text-[#b84335]">01</span>
                <div><h3 className="m-0 text-sm font-extrabold text-[#142c45]">ماء نظيف ومتاح</h3><p className="mb-0 mt-1.5 text-xs leading-6 text-[#65717d]">تأكد من توفر المياه ونظافة المشارب باستمرار.</p></div>
              </article>
              <article className="grid grid-cols-[36px_1fr] gap-3 border-t border-[#142c4522] py-4 sm:grid-cols-[44px_1fr]">
                <span className="pt-1 text-[11px] font-extrabold text-[#b84335]">02</span>
                <div><h3 className="m-0 text-sm font-extrabold text-[#142c45]">تهوية متوازنة</h3><p className="mb-0 mt-1.5 text-xs leading-6 text-[#65717d]">حافظ على تجدد الهواء، مع تجنب تعريض الطيور لتيارات مباشرة.</p></div>
              </article>
              <article className="grid grid-cols-[36px_1fr] gap-3 border-t border-[#142c4522] py-4 sm:grid-cols-[44px_1fr]">
                <span className="pt-1 text-[11px] font-extrabold text-[#b84335]">03</span>
                <div><h3 className="m-0 text-sm font-extrabold text-[#142c45]">فرشة جافة ونظافة دورية</h3><p className="mb-0 mt-1.5 text-xs leading-6 text-[#65717d]">تابع رطوبة الفرشة ونظف أماكن البلل للمساعدة في تقليل المشكلات الصحية.</p></div>
              </article>
              <article className="grid grid-cols-[36px_1fr] gap-3 border-y border-[#142c4522] py-4 sm:grid-cols-[44px_1fr]">
                <span className="pt-1 text-[11px] font-extrabold text-[#b84335]">04</span>
                <div><h3 className="m-0 text-sm font-extrabold text-[#142c45]">انتقال تدريجي بين الأعلاف</h3><p className="mb-0 mt-1.5 text-xs leading-6 text-[#65717d]">اختر العلف المناسب للمرحلة واتبع تعليمات العبوة أو توصية المختص عند التغيير.</p></div>
              </article>
            </div>
          </div>

          <figure className="m-0">
            <div className="relative aspect-[4/3] overflow-hidden bg-[#142c45] shadow-[14px_14px_0_#eadbb7]">
              <Image src="/factory.jpg" alt="منشأة لإنتاج الأعلاف" fill sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover brightness-125 contrast-110" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0e2237]/90 to-transparent px-5 pb-5 pt-16 text-sm font-bold text-white sm:px-7 sm:pb-7">منشأة لإنتاج الأعلاف</div>
            </div>
            <figcaption className="mt-4 text-xs leading-6 text-[#65717d]">الرعاية الجيدة تبدأ ببيئة مناسبة ومتابعة مستمرة لاحتياجات القطيع.</figcaption>
          </figure>
        </section>

        <section className="grid grid-cols-[56px_1fr] items-center gap-5 bg-[#fffdf8] px-6 py-16 sm:grid-cols-[82px_0.9fr_1.1fr] sm:gap-8 sm:px-10 lg:gap-16 lg:px-36 lg:py-24" id="about">
          <div className="grid h-14 w-14 place-items-center rounded-full border border-[#d7ad55] text-3xl font-black text-[#b84335] sm:h-20 sm:w-20 sm:text-5xl">ز</div>
          <div>
            <p className="mb-4 flex items-center gap-2.5 text-xs font-extrabold text-[#b84335]"><span className="h-0.5 w-6 bg-[#d7ad55]" /> عن أعلاف الزعيم</p>
            <h2 className="m-0 text-[clamp(1.6rem,3.4vw,2.5rem)] font-extrabold leading-[1.45] text-[#142c45]">كل مرحلة لها احتياجها.<br /><em className="not-italic text-[#b84335]">ونحن نبدأ من هنا.</em></h2>
          </div>
          <p className="col-span-2 m-0 text-[13px] leading-8 text-[#5f6872] sm:col-span-1 sm:text-sm">
            نؤمن أن العناية الجيدة تبدأ بفهم دورة التربية. لذلك نقدم اختيارات متعددة من الأعلاف، ونحرص أن تكون معلومات المنتج واضحة للمربي عند الاختيار.
          </p>
        </section>

        <footer className="grid grid-cols-2 items-center gap-x-5 gap-y-4 bg-[#0e2237] px-6 py-8 text-[#fffdf8] sm:grid-cols-[1fr_1.4fr_auto] sm:px-10 lg:px-28" id="contact">
          <Link href="/" className="text-[17px] font-extrabold text-white no-underline">أعلاف الزعيم<span className="mt-1 block text-[10px] font-semibold text-[#d7ad55]">تغذية لكل مرحلة</span></Link>
          <p className="col-span-2 m-0 text-xs leading-6 text-white/70 sm:col-span-1">للاستفسار عن المنتجات والتوفر، تواصل مع فريق المصنع.</p>
          <Link href="/login" className="col-start-2 row-start-1 whitespace-nowrap text-[11px] font-bold text-white no-underline hover:text-[#d7ad55] sm:col-start-auto sm:row-start-auto sm:text-[13px]">انتقل إلى النظام <span className="text-lg text-[#d7ad55]" aria-hidden="true">↗</span></Link>
          <small className="col-span-2 border-t border-white/15 pt-4 text-[10px] text-white/50 sm:col-span-3">© {new Date().getFullYear()} مصنع أعلاف الزعيم</small>
        </footer>
      </main>
    </div>
  );
}
