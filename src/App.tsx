import { MiniWindow } from "./components/MiniWindow";
import { RoomWorkspace } from "./components/RoomWorkspace";
import { useTeleport } from "./hooks/useTeleport";

export function App() {
  const model = useTeleport();
  return model.isMiniWindow ? <MiniWindow model={model} /> : <RoomWorkspace model={model} />;
}
