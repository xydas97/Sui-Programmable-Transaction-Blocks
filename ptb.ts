import {
  Connection,
  Ed25519Keypair,
  JsonRpcProvider,
  RawSigner,
  TransactionBlock,
  fromB64,
  toB64,
} from "@mysten/sui.js";
import { blake2b } from "@noble/hashes/blake2b";

const provider = new JsonRpcProvider(
  new Connection({
    fullnode: "https://fullnode.testnet.sui.io:443",
    faucet: "https://faucet.testnet.sui.io",
  })
);

const privateKey = "16/DxkhBCdKkCBOEXsWonMeEM/g8E+IjFZx6EUMlCng=";
const prKey = "17/DxkhBCdKkCBOEXsWonMeEM/g8E+IjFZx6EUMlCng=";

// For Ed25519
const edFromKeypair = Ed25519Keypair.fromSecretKey(fromB64(privateKey));

// address = 0xe7adfa0df2a0ab8892ebcf2950050bd6906789c709f1defcca2e3b4b120529de
const userSigner = new RawSigner(edFromKeypair, provider);
const address = edFromKeypair.getPublicKey().toSuiAddress();

const sponsorSigner = new RawSigner(
  Ed25519Keypair.fromSecretKey(fromB64(prKey)),
  provider
);
const sponsor = Ed25519Keypair.fromSecretKey(fromB64(prKey))
  .getPublicKey()
  .toSuiAddress();

// sponsor = 0xde741c594107f8b6e0914872b2802b3721304e7fd8dae4648b399b51cd2aea86

const recipient =
  "0x9dad4ec69e709fc45092b7668af3d06c4feef6403c7091074701d2955cc43a07";


// ------- Commands that write/modify data on-chain ------- //

// tx.splitCoins();
// tx.mergeCoins();
// tx.transferObjects();
// tx.moveCall();
// tx.publish();
// tx.upgrade();

// ------- Commands to create inputs for PTBs ------- //

// tx.pure();
// tx.object();
// tx.makeMoveVec();
// tx.objectRef();
// tx.sharedObjectRef();

// ------- Commands that are gas related ------- //

// tx.setGasPrice();
// tx.setGasPayment();
// tx.setGasOwner();
// tx.setGasSender();

// 1. WaitForEffectsCert: waits for TransactionEffectsCert and then return to client. This mode is a proxy for transaction finality.
// 2. WaitForLocalExecution: waits for TransactionEffectsCert and make sure the node executed the transaction locally before returning the client.

// max_input_objects: Some(2048)
// max_programmable_tx_commands: Some(1024)




// paySUI(recipient, 100000000).then((res) => console.log(res));

async function paySUI(recipient: string, amount: number) {
  const tx = new TransactionBlock();
  const coin = tx.splitCoins(tx.gas, [tx.pure(amount)]);
  tx.transferObjects([coin], tx.pure(recipient));

  return await userSigner.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    options: {
      showObjectChanges: true,
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
    },
    requestType: "WaitForLocalExecution",
  });
}


// payAllSui(recipient).then((res) => console.log(res));

async function payAllSui(recipient: string) {
  const tx = new TransactionBlock();
  tx.transferObjects([tx.gas], tx.pure(recipient));

  return await userSigner.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
    },
    requestType: "WaitForLocalExecution",
  });
}


// payMultipleSui([recipient, sponsor], [100000000, 200000000]).then((res) => console.log(res));

async function payMultipleSui(recipients: string[], amounts: number[]) {
  const tx = new TransactionBlock();
  const coins = tx.splitCoins(
    tx.gas,
    amounts.map((amount) => tx.pure(amount))
  );
  recipients.forEach((recipient, index) => {
    tx.transferObjects([coins[index]], tx.pure(recipient));
  });

  return await userSigner.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
    },
    requestType: "WaitForLocalExecution",
  });
}


// sponsoredTransaction(address, recipient, 500000000).then((res) => console.log(res));

async function sponsoredTransaction(
  sender: string,
  recipient: string,
  amount: number
) {
  const tx = new TransactionBlock();

  const coins = await provider.getCoins({ owner: sender });

  const coin = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [
    tx.pure(amount),
  ]);
  tx.transferObjects([coin], tx.pure(recipient));

  // Build the transaction into TransactionBytes
  const kindBytes = await tx.build({ provider, onlyTransactionKind: true });

  // Send the transaction bytes to the sponsor to fill the gas payment and sign
  const sponsoredTx = await sponsorTransaction(kindBytes, sender);

  // Now the user has to sign the transaction
  const signedTx = await userSigner.signTransactionBlock({
    transactionBlock: TransactionBlock.from(sponsoredTx.transactionBlockBytes),
  });

  // Send the transaction bytes to fullnode along with the signatures of user and sponsor
  // to execute the transaction
  return await provider.executeTransactionBlock({
    transactionBlock: signedTx.transactionBlockBytes,
    signature: [signedTx.signature, sponsoredTx.signature],
    options: {
      showEffects: false,
      showBalanceChanges: true,
      showEvents: false,
      showInput: false,
      showObjectChanges: false,
    },
  });
}

async function sponsorTransaction(kindBytes: Uint8Array, sender: string) {
  // Get the TransactionBlock from the bytes received
  const tx = TransactionBlock.fromKind(kindBytes);
  const coins = await provider.getCoins({ owner: sponsor });
  // Set as gas owner the sponsorAddress
  tx.setGasOwner(sponsor);
  // sender must be set from sponsor
  tx.setSender(sender);

  // Sign the transaction and return the SignedTransaction back to the user
  return await sponsorSigner.signTransactionBlock({ transactionBlock: tx });
}


// Building offline transactions

interface ObjectRef {
  objectId: string;
  version: string;
  digest: string;
}

// main();

const main = async () => {
  // this can be gotten with provider.getObject for each coin above, or through transaction responses
  const allCoins = await provider.getCoins({ owner: address });
  const coinRefs: ObjectRef[] = allCoins.data.map((coin) => {
    return {
      objectId: coin.coinObjectId,
      version: coin.version,
      digest: coin.digest,
    };
  });

  const txBytes = await getTxBytes(coinRefs, 1000000, recipient, address);
  const signature = getSignature(txBytes, edFromKeypair, 0);
  // this will be returned by the execution response
  const digest = await userSigner.getTransactionBlockDigest(txBytes);
  console.log("The transaction digest is: ", digest);

  // execution
  const result = await execute(txBytes, signature, provider);

  console.log(result);
  // check the digest
  console.log(
    "The digest in the response match with the one we had: ",
    result.digest === digest
  );
};

const getTxBytes = async (
  coinRefs: ObjectRef[],
  amount: number,
  recipient: string,
  sender: string
) => {
  const tx = new TransactionBlock();
  tx.setGasPayment(coinRefs);
  tx.setGasBudget(100000000);
  tx.setGasOwner(sender);
  tx.setGasPrice(1000);
  tx.setSender(sender);
  const coin = tx.splitCoins(tx.gas, [tx.pure(amount)]);
  tx.transferObjects([coin], tx.pure(recipient));
  return await tx.build();
};

const getSignature = (
  txBytes: Uint8Array,
  keypair: Ed25519Keypair,
  schemeByte: number
) => {
  const dataToSign = new Uint8Array(3 + txBytes.length);
  dataToSign.set([0, 0, 0]);
  dataToSign.set(txBytes, 3);
  const digest = blake2b(dataToSign, { dkLen: 32 });
  const rawSignature = keypair.signData(digest);
  const pubKey = keypair.getPublicKey().toBytes();
  const signature = new Uint8Array(1 + rawSignature.length + pubKey.length);
  signature.set([schemeByte]);
  signature.set(rawSignature, 1);
  signature.set(pubKey, 1 + rawSignature.length);
  return signature;
};

const execute = async (
  txBytes: Uint8Array,
  signature: Uint8Array,
  provider: JsonRpcProvider
) => {
  const result = await provider.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: toB64(signature),
    options: { showBalanceChanges: true, showObjectChanges: true },
    requestType: "WaitForLocalExecution",
  });
  return result;
};