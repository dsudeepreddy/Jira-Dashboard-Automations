'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      onClick={toggleTheme}
      className="relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/60 text-slate-600 shadow-glass backdrop-blur-xl transition hover:border-cyan-400/70 hover:text-cyan-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-cyan-400/50 dark:hover:text-cyan-300"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -90, scale: 0.65 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.65 }}
          transition={{ duration: 0.22 }}
        >
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
