// Accessible, visually distinct palette for timeline bars
const PALETTE = [
  { bg: '#dbeafe', bar: '#3b82f6', text: '#1d4ed8' }, // blue
  { bg: '#dcfce7', bar: '#22c55e', text: '#15803d' }, // green
  { bg: '#fef3c7', bar: '#f59e0b', text: '#b45309' }, // amber
  { bg: '#fce7f3', bar: '#ec4899', text: '#be185d' }, // pink
  { bg: '#ede9fe', bar: '#8b5cf6', text: '#6d28d9' }, // violet
  { bg: '#ffedd5', bar: '#f97316', text: '#c2410c' }, // orange
  { bg: '#ccfbf1', bar: '#14b8a6', text: '#0f766e' }, // teal
  { bg: '#fee2e2', bar: '#ef4444', text: '#b91c1c' }, // red
]

export function getColor(index: number) {
  return PALETTE[index % PALETTE.length]
}
