# Development Guide 🛠️

This document provides comprehensive setup instructions, development workflow, debugging tips, and contribution guidelines for the MeetCal application.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Git**
- **Expo CLI** (`npm install -g @expo/cli`)
- **EAS CLI** (`npm install -g eas-cli`)

### Platform-Specific Requirements

#### iOS Development
- **Xcode** (latest version)
- **iOS Simulator** or physical iOS device
- **Apple Developer Account** (for device testing and app store deployment)

#### Android Development
- **Android Studio**
- **Android SDK** (API level 21 or higher)
- **Android Emulator** or physical Android device

## Project Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/meetcal.git
cd meetcal
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Environment Configuration

Create environment files for different stages:

#### `.env.local` (Development)
```bash
# Supabase Configuration
EXPO_PUBLIC_SUPABASE_URL=your_development_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_development_anon_key

# Clerk Authentication
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key

# RevenueCat (Subscriptions)
EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=your_ios_revenuecat_key
EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=your_android_revenuecat_key

# PostHog Analytics
EXPO_PUBLIC_POSTHOG_API_KEY=your_posthog_api_key
EXPO_PUBLIC_POSTHOG_HOST=your_posthog_host

# Project Configuration
EXPO_PUBLIC_PROJECT_ID=your_expo_project_id
```

#### `.env.staging` (Staging)
```bash
# Similar to .env.local but with staging environment URLs
EXPO_PUBLIC_SUPABASE_URL=your_staging_supabase_url
# ... other staging environment variables
```

#### `.env.production` (Production)
```bash
# Production environment variables
EXPO_PUBLIC_SUPABASE_URL=your_production_supabase_url
# ... other production environment variables
```

### 4. Database Setup

#### Supabase Local Development

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase instance
supabase start

# Run migrations
supabase db reset

# Generate TypeScript types
supabase gen types typescript --local > lib/database.types.ts
```

#### Database Seeding

```bash
# Seed development data
npm run db:seed

# Or run specific seed files
npx supabase seed --db-url your_local_supabase_url
```

### 5. Start Development Server

```bash
# Start Expo development server
npm start
# or
yarn start

# Start with specific platform
npm run ios      # iOS simulator
npm run android  # Android emulator
npm run web      # Web browser
```

## Development Workflow

### Branch Strategy

We follow a Git Flow-inspired branching strategy:

```
main                 # Production-ready code
├── develop          # Integration branch
├── feature/xxx      # Feature branches
├── bugfix/xxx       # Bug fix branches
├── hotfix/xxx       # Emergency fixes
└── release/x.x.x    # Release preparation
```

### Feature Development

1. **Create Feature Branch**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Write code following project conventions
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Changes**
   ```bash
   npm run test        # Run unit tests
   npm run lint        # Check code style
   npm run type-check  # TypeScript checks
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   # Create pull request via GitHub
   ```

### Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(auth): add social login support
fix(schedule): resolve timezone display issue
docs(readme): update installation instructions
style(components): format button component
refactor(utils): extract time formatting logic
test(auth): add unit tests for login flow
chore(deps): update dependencies
```

### Code Style Guidelines

#### TypeScript

```typescript
// Use strict typing
interface UserProfile {
  id: string
  name: string
  email: string
  role: UserRole
}

// Prefer const assertions for constants
const USER_ROLES = {
  ATHLETE: 'Athlete',
  COACH: 'Coach',
} as const

// Use proper error handling
try {
  const user = await fetchUser(id)
  return user
} catch (error) {
  console.error('Failed to fetch user:', error)
  throw new Error('User fetch failed')
}
```

#### React Components

```typescript
// Use functional components with TypeScript
interface ButtonProps {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

export function Button({ 
  title, 
  onPress, 
  variant = 'primary', 
  disabled = false 
}: ButtonProps) {
  // Component implementation
}

// Use proper hooks
const [loading, setLoading] = useState(false)
const { user } = useUser()

// Memoize expensive operations
const expensiveValue = useMemo(() => {
  return heavyCalculation(data)
}, [data])
```

#### File Naming

```
PascalCase for components:     Button.tsx, ThemedText.tsx
camelCase for utilities:       authCache.ts, validation.ts
kebab-case for screens:        sign-in.tsx, athlete-results.tsx
UPPER_CASE for constants:      COLORS.ts, API_ENDPOINTS.ts
```

## Testing

### Test Structure

```
__tests__/
├── components/          # Component tests
├── utils/              # Utility function tests
├── screens/            # Screen/integration tests
├── hooks/              # Custom hook tests
└── __mocks__/          # Mock files
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test Button.test.tsx

# Run tests for specific pattern
npm test -- --testNamePattern="authentication"
```

### Writing Tests

#### Component Testing

```typescript
// components/__tests__/Button.test.tsx
import { render, fireEvent } from '@testing-library/react-native'
import { Button } from '../Button'

describe('Button Component', () => {
  it('renders correctly', () => {
    const { getByText } = render(
      <Button title="Test Button" onPress={() => {}} />
    )
    expect(getByText('Test Button')).toBeTruthy()
  })

  it('calls onPress when tapped', () => {
    const mockPress = jest.fn()
    const { getByText } = render(
      <Button title="Test Button" onPress={mockPress} />
    )
    
    fireEvent.press(getByText('Test Button'))
    expect(mockPress).toHaveBeenCalledTimes(1)
  })

  it('handles disabled state', () => {
    const mockPress = jest.fn()
    const { getByText } = render(
      <Button title="Test Button" onPress={mockPress} disabled />
    )
    
    fireEvent.press(getByText('Test Button'))
    expect(mockPress).not.toHaveBeenCalled()
  })
})
```

#### Utility Testing

```typescript
// utils/__tests__/time.test.ts
import { formatTime, parseSwimTime } from '../time'

describe('Time Utilities', () => {
  describe('formatTime', () => {
    it('formats time correctly', () => {
      const date = new Date('2024-01-01T14:30:00Z')
      expect(formatTime(date)).toBe('2:30 PM')
      expect(formatTime(date, true)).toBe('14:30')
    })
  })

  describe('parseSwimTime', () => {
    it('parses swim time correctly', () => {
      expect(parseSwimTime('1:23.45')).toBe(83450)
      expect(parseSwimTime('23.45')).toBe(23450)
      expect(parseSwimTime('invalid')).toBe(null)
    })
  })
})
```

### Mock Setup

#### Supabase Mock

```typescript
// __mocks__/supabase.ts
export const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
  auth: {
    getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
  },
}
```

## Debugging

### Development Tools

#### Flipper Integration

```typescript
// Debug network requests
import { NetworkingModule } from 'react-native-flipper'

// Log network calls
NetworkingModule.addNetworkInterceptor((request, response) => {
  console.log('Network Request:', request)
  console.log('Network Response:', response)
})
```

#### React Native Debugger

```bash
# Install React Native Debugger
brew install --cask react-native-debugger

# Or download from GitHub releases
# Start debugger on port 8081 (default Metro port)
```

#### Remote Debugging

```typescript
// Enable remote debugging
if (__DEV__) {
  import('./ReactotronConfig').then(() => console.log('Reactotron Configured'))
}
```

### Error Tracking

#### PostHog Integration

```typescript
// Error tracking with PostHog
import { posthog } from '@/lib/posthog'

export function trackError(error: Error, context?: Record<string, any>) {
  posthog?.capture('error', {
    error: error.message,
    stack: error.stack,
    context,
  })
}
```

#### Sentry Setup (Optional)

```bash
npm install @sentry/react-native

# Initialize Sentry
npx @sentry/wizard -i reactNative -p ios android
```

### Common Issues

#### Metro Bundler Issues

```bash
# Clear Metro cache
npx react-native start --reset-cache

# Clear all caches
npm start -- --clear

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### iOS Simulator Issues

```bash
# Reset iOS simulator
Device > Erase All Content and Settings

# Rebuild iOS app
rm -rf ios/build
npm run ios
```

#### Android Emulator Issues

```bash
# Clean Android build
cd android
./gradlew clean
cd ..

# Rebuild Android app
npm run android
```

### Performance Debugging

#### React Native Performance Monitor

```typescript
// Enable performance monitoring in development
if (__DEV__) {
  const { enableScreens } = require('react-native-screens')
  enableScreens()
  
  // Monitor JS thread performance
  require('react-native').YellowBox.ignoreWarnings([
    'Require cycle:',
  ])
}
```

#### Memory Leak Detection

```typescript
// Use React DevTools Profiler
// Monitor component re-renders
function useWhyDidYouUpdate(name: string, props: Record<string, any>) {
  const previous = useRef<Record<string, any>>()
  
  useEffect(() => {
    if (previous.current) {
      const allKeys = Object.keys({ ...previous.current, ...props })
      const changedKeys: Record<string, any> = {}
      
      allKeys.forEach(key => {
        if (previous.current![key] !== props[key]) {
          changedKeys[key] = {
            from: previous.current![key],
            to: props[key],
          }
        }
      })
      
      if (Object.keys(changedKeys).length) {
        console.log('[why-did-you-update]', name, changedKeys)
      }
    }
    
    previous.current = props
  })
}
```

## Code Quality

### Linting

```bash
# Run ESLint
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Run TypeScript checks
npm run type-check
```

### Pre-commit Hooks

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "pre-push": "npm run type-check && npm test"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write",
      "git add"
    ]
  }
}
```

### Code Coverage

```bash
# Generate coverage report
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

## Contributing

### Pull Request Process

1. **Fork the repository**
2. **Create a feature branch** from `develop`
3. **Make your changes** following code style guidelines
4. **Add tests** for new functionality
5. **Update documentation** as needed
6. **Run tests and linting** to ensure quality
7. **Submit pull request** with clear description

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Screenshots
(if applicable)

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
```

### Code Review Guidelines

#### For Authors
- Keep PRs small and focused
- Write clear commit messages
- Add comprehensive tests
- Update documentation
- Respond to feedback promptly

#### For Reviewers
- Review for functionality, not just style
- Test the changes locally
- Provide constructive feedback
- Approve only when confident in quality

## Documentation

### Updating Documentation

When making changes, update relevant documentation:

- **README.md** - Project overview and quick start
- **docs/** - Detailed documentation
- **Code comments** - Complex logic explanation
- **API docs** - Function/component documentation

### JSDoc Standards

```typescript
/**
 * Fetches user profile from the database
 * @param userId - The unique identifier for the user
 * @param includeTeam - Whether to include team information
 * @returns Promise resolving to user profile or null if not found
 * @throws {Error} When database connection fails
 * @example
 * ```typescript
 * const profile = await getUserProfile('123', true)
 * ```
 */
export async function getUserProfile(
  userId: string,
  includeTeam: boolean = false
): Promise<UserProfile | null> {
  // Implementation
}
```

---

*This development guide ensures consistent, high-quality contributions to the MeetCal project.*