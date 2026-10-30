# Sepolia - deploy storico OBSOLETO (validator e commit-reveal)

> **ARCHIVIO: questi sono gli indirizzi della versione precedente di FairJack.**
> Non usarli per configurare il frontend attuale con Chainlink VRF.
> Il vecchio FairJackPool non espone la nuova ABI e non è aggiornabile.

Questi indirizzi erano indicati come "deploy ufficiale" nel README della
versione con validator e commit-reveal, conservato nel commit `8cab9ca`.
La data di quel deploy non è registrata qui: la distinzione è basata sulla
versione del protocollo, non su una data presunta.

Rete: **Ethereum Sepolia**, chain ID **11155111**.

| Contratto della versione storica | Indirizzo archiviato |
| --- | --- |
| MockERC20 / FJT | [`0x8D95D8fB19f295fD08Bb10264C9cafe5bB7d9EC0`](https://sepolia.etherscan.io/address/0x8D95D8fB19f295fD08Bb10264C9cafe5bB7d9EC0) |
| FairJackPool con validator e commit-reveal | [`0x083d6c4402A5D9fAdfD6Bc99d0f6c4DE265aa6D0`](https://sepolia.etherscan.io/address/0x083d6c4402A5D9fAdfD6Bc99d0f6c4DE265aa6D0) |

Il token è elencato per identificare la coppia di contratti del vecchio deploy;
questo archivio non lo propone come token del prossimo deploy VRF.
Anche la [relazione PDF nella root](../../report.pdf) documenta la versione
storica con validator e commit-reveal, non la nuova implementazione VRF.

## Quali indirizzi usare dopo il prossimo deploy

Segui [le istruzioni attuali nel README](../../README.md#nuovo-deploy-su-ethereum-sepolia).
`npm run deploy:sepolia` distribuisce i nuovi contratti e genera
`frontend/.env.local` con indirizzi, versione del protocollo, rete e timestamp.
Controlla che l'intestazione indichi **FairJack VRF** e **Sepolia / 11155111**.
Un successivo deploy locale può sovrascrivere quel file: conserva una copia
della configurazione Sepolia prima di passare alla rete locale.

L'indirizzo `VRF_WRAPPER_ADDRESS` nei parametri di deploy identifica il servizio
Chainlink su Sepolia. Non è l'indirizzo di FairJackPool e non appartiene alla
coppia di contratti FairJack archiviata sopra.
