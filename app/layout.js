import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "./componetns/Slide"; // عدلنا اسم المتغير لـ Sidebar وحافظنا على المسار بتاعك

import Providers from "./componetns/providers";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Factory ERP",
  description: "ERP System for Management",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex bg-gray-100">
        <Providers>
           {/* الشريط الجانبي الثابت على اليمين */}
        <Sidebar />
        
        {/* محتوى الصفحة الرئيسي */}
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
        </Providers>
       
      </body>
    </html>
  );
}