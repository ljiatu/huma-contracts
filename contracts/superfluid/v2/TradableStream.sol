// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {CFALib} from "../CFALib.sol";
import "hardhat/console.sol";

struct TradableStreamMetadata {
    uint256 duration;
    uint256 started;
    address origin;
    address receiver;
    ISuperToken token;
    int96 flowrate;
}

// A TradableStream's maximum duration is one month.
uint256 constant MAX_DURATION_SECONDS = 60 * 60 * 24 * 30;

contract TradableStream is ERC721, Ownable {
    using CFAv1Library for CFAv1Library.InitData;
    using CFALib for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;

    /// @dev when a TradableStream is transferred for the first time and engaged
    event TradableStreamStarted(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver,
        // the timestamp where the TradableStream will become burnable
        uint256 matureAt
    );

    /// @dev when a TradableStream is burned
    event TradableStreamTerminated(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver
    );

    event RefundExtraToken(
        address receiver,
        address owner,
        uint256 refundAmount,
        uint256 sendAmount
    );

    /// @notice token ids => metadata
    mapping(uint256 => TradableStreamMetadata) public metadatas;

    /// @notice origin => investor => total acquired flowrate
    mapping(address => mapping(address => int96)) private _investments;

    /// @notice current token id
    uint256 public nextId;

    constructor(ISuperfluid host) payable Ownable() ERC721("Niflot", "NIFLOT") {
        IConstantFlowAgreementV1 cfa = IConstantFlowAgreementV1(
            address(
                host.getAgreementClass(
                    keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1")
                )
            )
        );

        cfaV1 = CFAv1Library.InitData(host, cfa);
    }

    /// @dev require that tokenId exists (minted and not burnt)
    /// @param tokenId Token ID whose existance is being checked
    modifier exists(uint256 tokenId) {
        require(_exists(tokenId), "token doesn't exist or has been burnt");
        _;
    }

    /// @notice Burns a mature TradableStream, restoring the original stream from origin to receiver
    /// @dev Anyone can call this method at any time
    /// @dev  Will revert if TradableStream is not mature
    /// @dev See `_beforeTokenTransfer` for the handover process.
    /// @param tokenId The token ID of the TradableStream that is being burned
    function burn(uint256 tokenId) external onlyOwner {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        require(meta.started == 0 || isMature(tokenId), "cant burn a non mature TradableStream");

        _burn(tokenId);

        emit TradableStreamTerminated(tokenId, meta.origin, meta.receiver);
    }

    // TODO: potentially add a dedicated flowrate so don't have to sell everything at once.
    /// @notice Mint a TradableStream against a stream you're receiving
    /// @param token the currency this TradableStream is based on
    /// @param origin the source that streams `token` to your account
    /// @param flowrate how much flowrate will be moved out
    /// @param durationInSeconds how long this TradableStream will run after it's been transferred for the first time
    function mint(
        ISuperToken token,
        address origin,
        int96 flowrate,
        uint256 durationInSeconds
    ) external {
        // Accepted token toggle?

        require(flowrate > 0, "Invalid flowrate");

        require(
            MAX_DURATION_SECONDS >= durationInSeconds,
            "TradableStream duration exceeds one month"
        );

        // Get flow from origin to receiver
        (, int96 allFlowrate, , ) = cfaV1.cfa.getFlow(token, origin, msg.sender);

        // Get investments
        int96 alreadyInvested = _investments[origin][msg.sender];
        require(allFlowrate > alreadyInvested, "you don't have any available flowrate");
        int96 availableFlowrate = allFlowrate - alreadyInvested;

        require(flowrate < availableFlowrate, "you don't have enough available flowrate");

        metadatas[nextId] = TradableStreamMetadata({
            origin: origin,
            receiver: msg.sender,
            flowrate: flowrate,
            token: token,
            duration: durationInSeconds,
            started: 0
        });

        //will start streaming from TradableStream to msg.sender / receiver
        _mint(msg.sender, nextId);
        nextId += 1;
    }

    function _beforeTokenTransfer(
        address oldReceiver,
        address newReceiver,
        uint256 tokenId
    ) internal override {
        //blocks transfers to superApps - done for simplicity, but you could support super apps in a new version!
        require(
            !cfaV1.host.isApp(ISuperApp(newReceiver)) || newReceiver == address(this),
            "New receiver cannot be a superApp"
        );

        TradableStreamMetadata memory meta = metadatas[tokenId];

        require(newReceiver != meta.origin, "can't transfer a TradableStream to its origin");

        if (oldReceiver == address(0)) {
            //minted
            _investments[meta.origin][newReceiver] += meta.flowrate;
        } else if (newReceiver == address(0)) {
            //burnt
            _investments[meta.origin][oldReceiver] -= meta.flowrate;
            delete metadatas[tokenId];

            //burnt
            cfaV1._decreaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                oldReceiver,
                meta.flowrate
            );
            cfaV1._increaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                meta.receiver,
                meta.flowrate
            );
        } else {
            //transfer
            //transfer
            if (meta.started == 0) {
                metadatas[tokenId].started = block.timestamp;
                emit TradableStreamStarted(
                    tokenId,
                    meta.origin,
                    meta.receiver,
                    block.timestamp + meta.duration
                );
            } else {
                if (isMature(tokenId)) {
                    revert("this niflot is mature and can only be burnt");
                }
            }

            _investments[meta.origin][oldReceiver] -= meta.flowrate;
            _investments[meta.origin][newReceiver] += meta.flowrate;

            //handover flow
            cfaV1._decreaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                oldReceiver,
                meta.flowrate
            );
            cfaV1._increaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                newReceiver,
                meta.flowrate
            );
        }
    }

    function endsAt(uint256 tokenId) public view exists(tokenId) returns (uint256) {
        if (metadatas[tokenId].started == 0) return 0;

        return metadatas[tokenId].started + metadatas[tokenId].duration;
    }

    function isMature(uint256 tokenId) public view exists(tokenId) returns (bool) {
        uint256 _endsAt = endsAt(tokenId);
        if (_endsAt == 0) return false;
        return (_endsAt < block.timestamp);
    }

    function remainingValue(uint256 tokenId)
        public
        view
        exists(tokenId)
        returns (ISuperToken token, uint256 value)
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        assert(meta.flowrate > 0);

        token = meta.token;
        int256 remainingSeconds;
        if (meta.started == 0) {
            remainingSeconds = int256(meta.duration);
        } else {
            remainingSeconds =
                int256(meta.started) +
                int256(meta.duration) -
                int256(block.timestamp);
        }

        if (remainingSeconds <= 0) {
            value = 0;
        } else {
            value = uint256(remainingSeconds) * uint256(uint96(meta.flowrate));
        }
    }

    function getTradableStreamData(uint256 tokenId)
        public
        view
        exists(tokenId)
        returns (
            address origin,
            address receiver,
            uint256 duration,
            uint256 started,
            uint256 until,
            ISuperToken token,
            int96 flowrate
        )
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        return (
            meta.origin,
            meta.receiver,
            meta.duration,
            meta.started,
            endsAt(tokenId),
            meta.token,
            meta.flowrate
        );
    }
}
