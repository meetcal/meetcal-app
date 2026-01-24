import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

type ThemeType = 'light' | 'dark';

type ThemeContextType = {
  currentTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const currentTheme: ThemeType = colorScheme === 'dark' ? 'dark' : 'light';

  const setTheme = () => {
    // Theme is locked to system; setter is a no-op to preserve API shape.
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme }}>
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
