import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke-style tab-bar icons, matching the brand palette instead of emoji.
 * Same shapes as the "vector icons" bottom-bar concept reviewed earlier —
 * plain 24x24 outline glyphs, colored via `color` so the active tab tints
 * with colors.primary and inactive tabs sit at colors.textSecondary.
 * `strokeWidth` defaults to 2 everywhere, but the tab bar's active/"Add"
 * chips pass a slightly bolder 2.4 so they read as pressed/primary next to
 * the thinner inactive icons. */

export interface TabIconProps {
  color: string;
  size?: number;
  strokeWidth?: number;
}

export function AgendaIcon({ color, size = 20, strokeWidth = 2 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={5} width={17} height={16} rx={2.5} />
      <Path d="M3.5 10h17" />
      <Path d="M8 3v4" />
      <Path d="M16 3v4" />
    </Svg>
  );
}

export function HistoryIcon({ color, size = 20, strokeWidth = 2 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7.5v5l3.5 2" />
    </Svg>
  );
}

// Gear/cog glyph, replacing the old 8-ray "sun" shape — that one read as a
// brightness or sun icon rather than Settings. The body and center hole are
// stroked like the other tab icons; the eight teeth are small filled tabs
// rotated around the center so they stay crisp at any strokeWidth.
const GEAR_TEETH_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function SettingsIcon({ color, size = 20, strokeWidth = 2 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={5.2} />
      <Circle cx={12} cy={12} r={2} fill={color} stroke="none" />
      {GEAR_TEETH_ANGLES.map((angle) => (
        <Rect
          key={angle}
          x={10.8}
          y={2.3}
          width={2.4}
          height={3}
          rx={0.6}
          fill={color}
          stroke="none"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </Svg>
  );
}

/** The centre "Add" tab's icon — a plain stroke plus, same 24x24 language as
 * the icons above, so the floating gradient button reads as part of the
 * same icon family instead of the old bold "+" text glyph. */
export function AddIcon({ color, size = 20, strokeWidth = 2 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 4v16" />
      <Path d="M4 12h16" />
    </Svg>
  );
}
