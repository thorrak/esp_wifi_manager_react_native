import { Fragment } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';

const DEFAULT_COLORS = {
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  background: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
};

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  theme?: ProvisioningTheme;
}

export function StepIndicator({
  currentStep,
  totalSteps,
  theme,
}: StepIndicatorProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  const DOT_SIZE = 10;
  const CURRENT_DOT_SIZE = 14;
  const LINE_HEIGHT = 2;

  return (
    <View style={styles.container}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepIndex = i + 1;
        const isCompleted = stepIndex < currentStep;
        const isCurrent = stepIndex === currentStep;
        const isFuture = stepIndex > currentStep;

        const dotSize = isCurrent ? CURRENT_DOT_SIZE : DOT_SIZE;

        return (
          <Fragment key={stepIndex}>
            {i > 0 && (
              <View
                style={[
                  styles.line,
                  {
                    height: LINE_HEIGHT,
                    backgroundColor: isCompleted || isCurrent ? c.primary : c.border,
                  },
                ]}
              />
            )}
            <View
              style={[
                styles.dot,
                {
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor:
                    isCompleted || isCurrent ? c.primary : 'transparent',
                  borderWidth: isFuture ? 2 : 0,
                  borderColor: isFuture ? c.border : 'transparent',
                },
                isCurrent && {
                  shadowColor: c.primary,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 4,
                  elevation: 4,
                },
              ]}
            />
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  dot: {
    // dimensions set dynamically
  },
  line: {
    flex: 1,
    marginHorizontal: 4,
  },
});
