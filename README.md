# FairJack

FairJack è un prototipo di blackjack decentralizzato su Ethereum.

## FairJack v1

La versione consegnabile include:

- blackjack semplificato;
- ERC20 token di test;
- Staked House Pool;
- shares per gli staker;
- validator con collateral;
- commit-reveal;
- timeout/slashing base;
- hit/stand;
- dealer automatico;
- payout automatico;
- frontend minimale.

## Struttura

- `contracts/`: smart contract Solidity
- `test/`: test Hardhat
- `scripts/`: script di deploy
- `frontend/`: frontend React + Vite + TypeScript

## Comandi principali

Compilazione contratti:

```bash
npm install
npx hardhat compile

Avvio frontend:

cd frontend
npm install
npm run dev
