import ConnectWallet from "./components/ConnectWallet";
import TokenPanel from "./components/TokenPanel";
import PoolPanel from "./components/PoolPanel";
import ValidatorPanel from "./components/ValidatorPanel";
import StartGame from "./components/StartGame";
import GameBoard from "./components/GameBoard";
import GameStatus from "./components/GameStatus";
import ActionButtons from "./components/ActionButtons";
import "./App.css";

export default function App() {
  return (
    <main className="app">
      <h1>FairJack</h1>
      <p>Decentralized blackjack with Staked House Pool</p>

      <ConnectWallet />
      <TokenPanel />
      <PoolPanel />
      <ValidatorPanel />
      <StartGame />
      <GameStatus />
      <GameBoard />
      <ActionButtons />
    </main>
  );
}
