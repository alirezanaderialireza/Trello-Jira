export default function BoardLoading() {
  // ساخت آرایه فرضی برای رندر کردن ۳ ستون اسکلت‌بندی شده
  const skeletonLists = Array.from({ length: 3 });

  return (
    <div className="h-screen flex flex-col bg-[#fbfbfd]">
      {/* 🌟 هدر بورد (اسکلت) */}
      <div className="w-full h-14 bg-white border-b border-gray-200/50 flex items-center px-6">
        <div className="w-48 h-6 bg-gray-200 rounded-md animate-pulse"></div>
      </div>

      {/* 🌟 بدنه بورد و لیست‌ها (اسکلت) */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex items-start gap-4 h-full">
          {skeletonLists.map((_, index) => (
            <div
              key={index}
              className="w-72 shrink-0 bg-gray-100/80 rounded-xl flex flex-col max-h-full border border-gray-200/50"
            >
              {/* هدر لیست */}
              <div className="p-3">
                <div className="w-32 h-5 bg-gray-200 rounded animate-pulse"></div>
              </div>

              {/* کارت‌های داخل لیست */}
              <div className="px-3 pb-3 flex flex-col gap-2">
                <div className="w-full h-20 bg-white rounded-lg shadow-sm border border-gray-100 animate-pulse"></div>
                <div className="w-full h-16 bg-white rounded-lg shadow-sm border border-gray-100 animate-pulse opacity-70"></div>
                {index === 0 && (
                  <div className="w-full h-24 bg-white rounded-lg shadow-sm border border-gray-100 animate-pulse opacity-50"></div>
                )}
              </div>
            </div>
          ))}

          {/* دکمه ساخت لیست جدید (اسکلت) */}
          <div className="w-72 shrink-0 bg-gray-200/40 rounded-xl h-12 animate-pulse border border-gray-200/50"></div>
        </div>
      </div>
    </div>
  );
}