import React, { useEffect } from 'react';
import { View, Image, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { ThemedText } from '@/components/ThemedText';

const { height, width } = Dimensions.get('window');

interface AnimatedSplashScreenProps {
  onAnimationComplete?: () => void;
}

export const AnimatedSplashScreen: React.FC<AnimatedSplashScreenProps> = ({
  onAnimationComplete,
}) => {
  const { currentTheme } = useTheme();
  const logoTranslateY = useSharedValue(-height);
  const logoScale = useSharedValue(0.8);
  const opacity = useSharedValue(1);
  const titleOpacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const loadingOpacity = useSharedValue(0);
  const loadingScale = useSharedValue(1);

  const animatedLogoStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: logoTranslateY.value },
        { scale: logoScale.value },
      ],
    };
  });

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  const animatedTitleStyle = useAnimatedStyle(() => {
    return {
      opacity: titleOpacity.value,
    };
  });

  const animatedTaglineStyle = useAnimatedStyle(() => {
    return {
      opacity: taglineOpacity.value,
    };
  });

  const animatedLoadingStyle = useAnimatedStyle(() => {
    return {
      opacity: loadingOpacity.value,
      transform: [{ scale: loadingScale.value }],
    };
  });

  const startAnimation = () => {
    // Bounce in from top with spring animation
    logoTranslateY.value = withSequence(
      withSpring(0, {
        damping: 12,
        stiffness: 100,
        mass: 1,
      }),
      withSpring(-20, {
        damping: 15,
        stiffness: 200,
        mass: 0.8,
      }),
      withSpring(0, {
        damping: 20,
        stiffness: 300,
        mass: 0.5,
      })
    );

    // Scale animation for extra bounce effect
    logoScale.value = withSequence(
      withSpring(1.1, {
        damping: 10,
        stiffness: 150,
        mass: 1,
      }),
      withSpring(0.95, {
        damping: 15,
        stiffness: 200,
        mass: 0.8,
      }),
      withSpring(1, {
        damping: 20,
        stiffness: 300,
        mass: 0.5,
      })
    );

    // Animate text elements in sequence
    titleOpacity.value = withDelay(300, withTiming(1, { duration: 400 }));
    taglineOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));
    loadingOpacity.value = withDelay(900, withTiming(1, { duration: 400 }));
    
    // Add gentle pulsing animation to loading text
    setTimeout(() => {
      loadingScale.value = withSequence(
        withTiming(1.05, { duration: 800 }),
        withTiming(1, { duration: 800 }),
        withTiming(1.05, { duration: 800 }),
        withTiming(1, { duration: 800 })
      );
    }, 1200);

    // After animation completes, fade out and call onAnimationComplete
    setTimeout(() => {
      opacity.value = withTiming(0, { duration: 400 }, () => {
        if (onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      });
    }, 2500); // Wait 2.5 seconds before starting fade out
  };

  useEffect(() => {
    // Start animation after a short delay
    const timer = setTimeout(startAnimation, 100);
    return () => clearTimeout(timer);
  }, []);

  const backgroundColor = currentTheme === 'dark' ? '#242831' : '#242831';

  return (
    <Animated.View style={[styles.container, { backgroundColor }, animatedContainerStyle]}>
      <View style={styles.content}>
        <Animated.View style={[styles.logoContainer, animatedLogoStyle]}>
          <Image
            source={require('@/assets/images/MeetCal-no-bg.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
        
        <Animated.View style={[styles.textContainer, animatedTitleStyle]}>
          <ThemedText style={styles.title}>MeetCal</ThemedText>
        </Animated.View>
        
        <Animated.View style={[styles.taglineContainer, animatedTaglineStyle]}>
          <ThemedText style={styles.tagline}>The Ultimate Olympic Weightlifting Meet Calendar</ThemedText>
        </Animated.View>
      </View>
      
      <Animated.View style={[styles.loadingContainer, animatedLoadingStyle]}>
        <ThemedText style={styles.loading}>Loading...</ThemedText>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  logo: {
    width: 180,
    height: 180,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 30,
    marginTop: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  taglineContainer: {
    alignItems: 'center',
    paddingHorizontal: 30,
    maxWidth: width - 40,
  },
  tagline: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    fontWeight: '300',
    lineHeight: 22,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loading: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    fontWeight: '400',
  },
});