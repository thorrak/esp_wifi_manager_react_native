/**
 * Minimal React Native mock for Jest tests.
 *
 * Only the APIs actually imported by the library are stubbed here.
 */

export const View = 'View';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const TouchableOpacity = 'TouchableOpacity';
export const ActivityIndicator = 'ActivityIndicator';
export const Modal = 'Modal';
export const FlatList = 'FlatList';
export const ScrollView = 'ScrollView';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  select: jest.fn((obj: Record<string, unknown>) => obj.ios ?? obj.default),
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: jest.fn((style: unknown) => style),
  hairlineWidth: 1,
};

const AnimatedValue = jest.fn().mockImplementation((val: number) => ({
  _value: val,
  setValue: jest.fn(),
  interpolate: jest.fn().mockReturnValue(0),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  stopAnimation: jest.fn(),
}));

export const Animated = {
  Value: AnimatedValue,
  timing: jest.fn().mockReturnValue({
    start: jest.fn((cb?: () => void) => cb?.()),
    stop: jest.fn(),
    reset: jest.fn(),
  }),
  loop: jest.fn().mockReturnValue({
    start: jest.fn((cb?: () => void) => cb?.()),
    stop: jest.fn(),
    reset: jest.fn(),
  }),
  View: 'Animated.View',
  Text: 'Animated.Text',
  Image: 'Animated.Image',
  createAnimatedComponent: jest.fn((comp: unknown) => comp),
};

export const Alert = {
  alert: jest.fn(),
};

export const Dimensions = {
  get: jest.fn().mockReturnValue({ width: 375, height: 812 }),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

export default {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Animated,
  Alert,
  Dimensions,
};
