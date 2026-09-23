/* eslint-disable */

// Replaces the generated (git-ignored) `expo-env.d.ts`, which does
// `/// <reference types="expo/types" />` and pulls in three files. We take two of
// them and deliberately skip the third, `expo/types/react-native-web`.
//
// That file augments `interface ViewStyle` with
//   position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
// for web. React Native 0.88 generates its style types, and the style prop `View`
// actually accepts (`____ViewStyleProp_Internal`) only allows
// 'static' | 'relative' | 'absolute'. The widened `ViewStyle` therefore no longer
// assigns to any `<View style>`, which breaks first-party components *and*
// libraries we don't control (react-native-view-shot). Still present in
// expo@58.0.0-preview.3 and expo@canary; drop this file once it is fixed upstream.
//
// MeetCal ships iOS and Android, so the web-only style properties are not a loss.

import 'expo-modules-core/types';
import 'expo/types/global';
import 'expo/types/metro-require';
