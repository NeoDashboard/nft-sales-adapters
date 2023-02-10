import * as dotenv from "dotenv";

dotenv.config();

import BigNumber from "bignumber.js";
import moment from "moment";
import { EventData } from "web3-eth-contract";
import path from "path";
import priceSdk from "../../sdk/price";
import Matic from "../../sdk/matic";
import symbolSdk from "../../sdk/symbol";
import { ISaleEntity, ISymbolAPIResponse } from "../../sdk/Interfaces";

class Element {
    name: string;
    token: string;
    protocol: string;
    block: number;
    deprecatedAtBlock: number;
    contract: string;
    events: string[];
    pathToAbi: string;
    range: number;
    chunkSize: number;
    sdk: any;

    constructor() {
        this.name = "ghostmarket-polygon";
        this.protocol = "matic";
        this.block = 39033114;
        this.contract = "0x3b48563237c32a1f886fd19db6f5affd23855e2a";
        this.events = ["OrderFilled"];
        this.pathToAbi = path.join(__dirname, "./abi.json");
        this.range = 500;
        this.chunkSize = 6;
    }

    run = async (): Promise<void> => {
        this.sdk = await this.loadSdk();

        await this.sdk.run();
    };

    loadSdk = (): any => {
        return new Matic(this);
    };

    stop = async (): Promise<void> => {
        this.sdk.stop();
    };

    _getToken = (event: EventData): string => {
        let token = "matic";
        if (event.returnValues["leftAsset"]['assetClass'] == '0x73ad2146') {
            if (event.returnValues["rightAsset"]["data"] != "0x") {
                token = this.sdk.web3.eth.abi.decodeParameter('address', event.returnValues["rightAsset"]["data"]).toLowerCase();
            }
        } else {
            if (event.returnValues["leftAsset"]["data"] != "0x") {
                token = this.sdk.web3.eth.abi.decodeParameter('address', event.returnValues["leftAsset"]["data"]).toLowerCase();
            }
        }

        return token;
    };

    process = async (event: EventData): Promise<void> => {
        const block = await this.sdk.getBlock(event.blockNumber);
        const timestamp = moment.unix(block.timestamp).utc();
        const token = this._getToken(event);
        const symbol: ISymbolAPIResponse = await symbolSdk.get(token, this.protocol);
        const po = await priceSdk.get(token, this.protocol, block.timestamp);
        let price = event.returnValues["newLeftFill"];
        let nativePrice = new BigNumber(price).dividedBy(10 ** (symbol?.decimals || 0));
        let seller = event.returnValues["leftMaker"].toLowerCase();
        let buyer = event.returnValues["rightMaker"].toLowerCase();
        let params = this.sdk.web3.eth.abi.decodeParameters(['address', 'uint256'], event.returnValues["leftAsset"]["data"]);
        if (event.returnValues["leftAsset"]['assetClass'] != '0x73ad2146') {
            price = event.returnValues["newRightFill"];
            nativePrice = new BigNumber(price).dividedBy(10 ** (symbol?.decimals || 0));
            seller = event.returnValues["rightMaker"];
            buyer = event.returnValues["leftMaker"];
            params = this.sdk.web3.eth.abi.decodeParameters(['address', 'uint256'], event.returnValues["rightAsset"]["data"]);
        }
        let nftContract = params[0];
        let tokenId = params[1];
        if (buyer == "0x09236d6b740ac67dca842d9db6fa4d067a684e76") {
            const txInfo = await this.sdk.getTransactionReceipt(event.transactionHash);
            buyer = txInfo.from.toLowerCase();
        }

        const entity = {
            providerName: this.name,
            providerContract: this.contract,
            protocol: this.protocol,
            nftContract: nftContract.toLowerCase(),
            nftId: tokenId,
            token: token.toLowerCase(),
            tokenSymbol: symbol?.symbol || "",
            amount: 1,
            price: nativePrice.toNumber(),
            priceUsd: !symbol?.decimals ? null : nativePrice.multipliedBy(po.price).toNumber(),
            seller: seller,
            buyer: buyer,
            soldAt: timestamp.format("YYYY-MM-DD HH:mm:ss"),
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
        };

        await this.addToDatabase(entity);
    };

    addToDatabase = async (entity: ISaleEntity): Promise<ISaleEntity> => {
        console.log(`creating sale for ${entity.nftContract} with id ${entity.nftId}`);
        return entity;
    };
}

export default Element;
