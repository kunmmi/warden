import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { C } from '@/ui/tokens';

/**
 * The bridge between the native splash and the first real screen.
 *
 * THE COLOUR HERE IS LOAD-BEARING. This overlay is the app's first frame, and it
 * must be the same colour as the screen underneath it — otherwise launching the
 * app is a flash of one colour followed by a cut to another. The template shipped
 * #208AEF with the Expo logo, so the first thing anyone saw was somebody else's
 * brand in bright blue before a near-black trading screen. It has to match
 * app.json's splash backgroundColor and the root contentStyle; all three are C.bg.
 *
 * The image is the warden mark on that same background, so the fade is a pure
 * opacity change with nothing behind it moving.
 */

const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: { transform: [{ scale: 1 }], opacity: 1 },
    20: { opacity: 1 },
    70: { opacity: 0, easing: Easing.elastic(0.7) },
    100: { opacity: 0, transform: [{ scale: 1 }], easing: Easing.elastic(0.7) },
  });

  const image = <Image style={styles.image} source={require('@/assets/images/splash-icon.png')} />;

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {image}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: 76,
    height: 76,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
