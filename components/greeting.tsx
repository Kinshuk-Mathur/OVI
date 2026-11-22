import { FlowerMark } from "./ovi-logo";

export function Greeting() {
  return (
    <div className="greeting">
      <FlowerMark className="greeting-flower" />
      <h1>Good evening, <span className="greeting-name">Kinshuk.</span></h1>
    </div>
  );
}
