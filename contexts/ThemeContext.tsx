import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

type ThemeType = 'light' | 'dark';

/**
 * The theme follows the system scheme; there is deliberately no setter. One
 * used to be exposed as a no-op "to preserve API shape", but no consumer ever
 * called it.
 */
type ThemeContextType = {
  currentTheme: ThemeType;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const currentTheme: ThemeType = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <ThemeContext.Provider value={{ currentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
} 
