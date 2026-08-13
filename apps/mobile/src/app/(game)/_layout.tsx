import { Stack } from 'expo-router/stack';

export default function GameLayout() {
  return <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }} />;
}
