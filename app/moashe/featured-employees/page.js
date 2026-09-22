import Image from 'next/image';

export default function FeaturedEmployeesPage() {
  return (
    <main className="min-h-screen bg-[#f7faf9] p-5 md:p-10" dir="rtl">
      <section className="mx-auto grid w-full max-w-5xl items-center gap-10 overflow-hidden rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl md:grid-cols-[1.05fr_1fr] md:p-10">
        <div className="order-2 space-y-6 text-center md:order-1 md:text-right">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">
            <span aria-hidden="true">★</span>
            تقدير وامتنان
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-emerald-600">الموظفون المميزون</p>
            <h1 className="text-4xl font-black leading-tight text-slate-900 md:text-5xl">
              شكرًا لمجهودك
            </h1>
            <p className="mt-4 text-lg font-bold leading-9 text-slate-600">
              كل إنجاز كبير يبدأ بشخص مخلص، وكل يوم عمل ناجح وراءه مجهود يستحق التقدير.
              شكرًا لالتزامك وتعبك وروحك الجميلة التي تضيف قيمة حقيقية لفريقنا.
            </p>
          </div>
          <div className="border-r-4 border-emerald-500 pr-4 text-right text-sm font-bold leading-8 text-slate-500">
            وجودك فارق، ومجهودك محل تقدير. نتمنى لك مزيدًا من النجاح والتألق دائمًا.
          </div>
          <p className="text-base font-black text-emerald-700">مع خالص الشكر والتقدير</p>
        </div>

        <div className="order-1 md:order-2">
          <div className="relative mx-auto aspect-4/5 w-full max-w-md rotate-1 rounded-3xl bg-emerald-100 p-3 shadow-lg transition-transform duration-500 hover:rotate-0">
            <div className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-100">
              <Image
                src="/mom.jpg"
                alt="الموظف المميز أثناء العمل"
                fill
                priority
                sizes="(max-width: 768px) 90vw, 430px"
                className="object-cover object-center"
              />
            </div>
            <div className="absolute -bottom-4 -left-4 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-amber-400 text-2xl text-white shadow-lg" aria-hidden="true">
              ★
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-8 grid w-full max-w-5xl items-center gap-10 overflow-hidden rounded-3xl border border-amber-100 bg-white p-6 shadow-xl md:grid-cols-[1fr_1.05fr] md:p-10">
        <div className="order-2 space-y-6 text-center md:order-1 md:text-right">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">
            <span aria-hidden="true">★</span>
            تكريم خاص
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-amber-600">الموظفون المميزون</p>
            <h2 className="text-3xl font-black leading-tight text-slate-900 md:text-5xl">
              شكر للأستاذ محمود
            </h2>
            <p className="mt-2 text-xl font-black text-amber-700">عميد مخازن الزعيم</p>
            <p className="mt-4 text-lg font-bold leading-9 text-slate-600">
              شكرًا يا أستاذ محمود على أمانتك والتزامك ومجهودك الكبير في إدارة المخازن.
              وجودك وخبرتك وتنظيمك أساس مهم لنجاح العمل، ودائمًا تستحق كل تقدير واحترام.
            </p>
          </div>
          <div className="border-r-4 border-amber-400 pr-4 text-right text-sm font-bold leading-8 text-slate-500">
            نتمنى لك دوام النجاح والتوفيق، ونقدّر كل ما تقدمه للفريق كل يوم.
          </div>
          <p className="text-base font-black text-amber-700">مع خالص الشكر والتقدير يا أستاذ محمود</p>
        </div>

        <div className="order-1 md:order-2">
          <div className="relative mx-auto aspect-4/5 w-full max-w-md -rotate-1 rounded-3xl bg-amber-100 p-3 shadow-lg transition-transform duration-500 hover:rotate-0">
            <div className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-100">
              <Image
                src="/mahmoud.jpeg"
                alt="الأستاذ محمود عميد مخازن الزعيم"
                fill
                sizes="(max-width: 768px) 90vw, 430px"
                className="object-cover object-center"
              />
            </div>
            <div className="absolute -bottom-4 -right-4 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-amber-500 text-2xl text-white shadow-lg" aria-hidden="true">
              ★
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
