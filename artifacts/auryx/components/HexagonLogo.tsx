import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polygon, Stop, G, Circle } from 'react-native-svg';

interface HexagonLogoProps {
  size?: number;
  animated?: boolean;
}

export function HexagonLogo({ size = 120, animated: anim = true }: HexagonLogoProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const rotateLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!anim) return;
    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
      ])
    );
    pulseLoopRef.current.start();
    rotateLoopRef.current = Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 12000, useNativeDriver: true })
    );
    rotateLoopRef.current.start();
    return () => { pulseLoopRef.current?.stop(); rotateLoopRef.current?.stop(); };
  }, [anim, pulse, rotate]);

  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.44;
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');

  const innerR = r * 0.72;
  const innerPoints = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + innerR * Math.cos(angle)},${cy + innerR * Math.sin(angle)}`;
  }).join(' ');

  const innerR2 = r * 0.50;
  const innerPoints2 = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + innerR2 * Math.cos(angle)},${cy + innerR2 * Math.sin(angle)}`;
  }).join(' ');

  const lockWidth = s * 0.18;
  const lockHeight = s * 0.20;
  const lockX = cx - lockWidth / 2;
  const lockY = cy - lockHeight / 2 + s * 0.02;
  const archWidth = lockWidth * 0.6;
  const archHeight = lockHeight * 0.52;
  const archX = cx - archWidth / 2;
  const archY = lockY - archHeight;

  return (
    <Animated.View pointerEvents="none" style={{ transform: [{ scale: pulse }] }}>
      <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <Defs>
          <LinearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F0CE60" />
            <Stop offset="1" stopColor="#B8960C" />
          </LinearGradient>
          <LinearGradient id="purpleGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#A78BFA" />
            <Stop offset="1" stopColor="#6D28D9" />
          </LinearGradient>
          <LinearGradient id="blueGrad" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#1D4ED8" />
            <Stop offset="1" stopColor="#60A5FA" />
          </LinearGradient>
          <LinearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#0A0F1E" />
            <Stop offset="1" stopColor="#1A2236" />
          </LinearGradient>
        </Defs>

        {/* Outer glow circles */}
        <Circle cx={cx} cy={cy} r={r * 1.25} fill="none" stroke="#D4AF37" strokeWidth="0.5" opacity={0.2} />
        <Circle cx={cx} cy={cy} r={r * 1.45} fill="none" stroke="#8B5CF6" strokeWidth="0.3" opacity={0.15} />

        {/* Outer hexagon */}
        <Polygon points={points} fill="url(#bgGrad)" stroke="url(#goldGrad)" strokeWidth={s * 0.022} />

        {/* Neon glow on outer edge */}
        <Polygon points={points} fill="none" stroke="#D4AF37" strokeWidth={s * 0.012} opacity={0.6} />

        {/* Inner hexagon 1 */}
        <Polygon points={innerPoints} fill="none" stroke="url(#purpleGrad)" strokeWidth={s * 0.015} opacity={0.8} />
        <Polygon points={innerPoints} fill="rgba(139,92,246,0.08)" />

        {/* Inner hexagon 2 */}
        <Polygon points={innerPoints2} fill="none" stroke="url(#blueGrad)" strokeWidth={s * 0.012} opacity={0.7} />
        <Polygon points={innerPoints2} fill="rgba(59,130,246,0.06)" />

        {/* Lock body */}
        <G>
          {/* Lock shackle (arch) */}
          <Path
            d={`M ${archX} ${lockY} L ${archX} ${archY + archHeight * 0.5}
              Q ${archX} ${archY - archHeight * 0.1} ${cx} ${archY - archHeight * 0.1}
              Q ${archX + archWidth} ${archY - archHeight * 0.1} ${archX + archWidth} ${archY + archHeight * 0.5}
              L ${archX + archWidth} ${lockY}`}
            fill="none"
            stroke="url(#goldGrad)"
            strokeWidth={s * 0.04}
            strokeLinecap="round"
          />
          {/* Lock body rect */}
          <Path
            d={`M ${lockX} ${lockY} 
               Q ${lockX} ${lockY - 2} ${lockX + 3} ${lockY - 2}
               L ${lockX + lockWidth - 3} ${lockY - 2}
               Q ${lockX + lockWidth} ${lockY - 2} ${lockX + lockWidth} ${lockY}
               L ${lockX + lockWidth} ${lockY + lockHeight}
               Q ${lockX + lockWidth} ${lockY + lockHeight + 3} ${lockX + lockWidth - 3} ${lockY + lockHeight + 3}
               L ${lockX + 3} ${lockY + lockHeight + 3}
               Q ${lockX} ${lockY + lockHeight + 3} ${lockX} ${lockY + lockHeight}
               Z`}
            fill="url(#goldGrad)"
            opacity={0.9}
          />
          {/* Keyhole */}
          <Circle cx={cx} cy={lockY + lockHeight * 0.42} r={s * 0.028} fill="#0A0F1E" />
          <Path
            d={`M ${cx - s * 0.018} ${lockY + lockHeight * 0.42}
               L ${cx - s * 0.012} ${lockY + lockHeight * 0.76}
               L ${cx + s * 0.012} ${lockY + lockHeight * 0.76}
               L ${cx + s * 0.018} ${lockY + lockHeight * 0.42}`}
            fill="#0A0F1E"
          />
        </G>

        {/* Corner accent dots */}
        {Array.from({ length: 6 }, (_, i) => {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const dotR = r * 1.08;
          return (
            <Circle
              key={i}
              cx={cx + dotR * Math.cos(angle)}
              cy={cy + dotR * Math.sin(angle)}
              r={s * 0.018}
              fill={i % 2 === 0 ? "#D4AF37" : "#8B5CF6"}
              opacity={0.9}
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
}
