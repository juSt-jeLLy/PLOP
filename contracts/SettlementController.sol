// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDarkPoolResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

/// @notice Verifies EIP-712 signatures and writes encrypted settlement instructions to ENS.
contract SettlementController {
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("SettlementAuthorization(bytes32 node,bytes32 payloadHash,uint256 expiry,bytes32 nonce)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    IDarkPoolResolver public immutable resolver;
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(address => mapping(bytes32 => bool)) public usedNonces;

    event SettlementRecorded(bytes32 indexed node, address indexed signer, bytes32 payloadHash);

    constructor(address resolverAddress) {
        require(resolverAddress != address(0), "SettlementController: resolver required");
        resolver = IDarkPoolResolver(resolverAddress);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PlopSettlementController")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function recordSettlement(
        bytes32 node,
        string calldata payload,
        uint256 expiry,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(block.timestamp <= expiry, "SettlementController: expired");

        bytes32 payloadHash = keccak256(bytes(payload));
        bytes32 structHash = keccak256(
            abi.encode(SETTLEMENT_TYPEHASH, node, payloadHash, expiry, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address signer = recoverSigner(digest, signature);
        require(signer != address(0), "SettlementController: invalid signature");
        require(!usedNonces[signer][nonce], "SettlementController: nonce used");
        usedNonces[signer][nonce] = true;

        resolver.setText(node, "plop.settlement", payload);
        emit SettlementRecorded(node, signer, payloadHash);
    }

    function recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
