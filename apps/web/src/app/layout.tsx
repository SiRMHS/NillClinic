import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { cn } from "@/lib/utils"
import { ThemeProvider } from "@/lib/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

const peyda = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "../../public/assets/fonts/PeydaWebFaNum-Thin.woff2", weight: "100", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-Light.woff2", weight: "300", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "../../public/assets/fonts/PeydaWebFaNum-Black.woff2", weight: "900", style: "normal" },
  ],
})

export const metadata: Metadata = {
  title: "کلینیک جردن | داشبورد مدیریتی",
  description: "داشبورد تحلیلی و مدیریتی کلینیک جردن",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fa" dir="rtl" className={cn("h-full", "antialiased", peyda.variable)}>
      <body className="min-h-full bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
