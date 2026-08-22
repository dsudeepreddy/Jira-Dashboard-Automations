import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Jira Analytics Dashboard',
  description: 'Delivery health from cycle time, sprint velocity, and remaining throughput.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('jira-theme');document.documentElement.classList.toggle('dark', t!=='light');document.documentElement.style.colorScheme=t==='light'?'light':'dark'}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
