// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IExtendedResolver } from "./interfaces/IExtendedResolver.sol";

interface IAddrResolver {
    function addr(bytes32 node) external view returns (address payable);
}

interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @notice ENS wildcard resolver with deterministic, rotating addresses.
contract DarkPoolResolver is IExtendedResolver {
    bytes4 private constant EXTENDED_RESOLVER_INTERFACE_ID = 0x9061b923;
    bytes4 private constant ADDR_INTERFACE_ID = 0x3b3b57de;
    bytes4 private constant TEXT_INTERFACE_ID = 0x59d1d43c;

    uint256 public constant EPOCH_SECONDS = 3600;

    address public engine;

    mapping(bytes32 => uint256) public rotationNonces;
    mapping(bytes32 => mapping(string => string)) private textRecords;

    event AddressRotated(bytes32 indexed node, uint256 newNonce);
    event TextRecordUpdated(bytes32 indexed node, string key, string value);

    constructor(address _engine) {
        require(_engine != address(0), "DarkPoolResolver: engine required");
        engine = _engine;
    }

    modifier onlyEngine() {
        require(msg.sender == engine, "DarkPoolResolver: not engine");
        _;
    }

    /// @notice ERC-165 support including ENSIP-10 wildcard resolver.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == EXTENDED_RESOLVER_INTERFACE_ID
            || interfaceId == ADDR_INTERFACE_ID
            || interfaceId == TEXT_INTERFACE_ID
            || interfaceId == 0x01ffc9a7; // ERC-165
    }

    /// @notice ENSIP-10 resolve entrypoint for wildcard subnames.
    function resolve(bytes calldata, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        require(data.length >= 4, "DarkPoolResolver: invalid data");
        bytes4 selector = bytes4(data[:4]);

        if (selector == IAddrResolver.addr.selector) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return abi.encode(addr(node));
        }

        if (selector == ITextResolver.text.selector) {
            (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
            return abi.encode(text(node, key));
        }

        revert("DarkPoolResolver: unsupported selector");
    }

    /// @notice Deterministically derive a session address from node + nonce + epoch.
    function addr(bytes32 node) public view returns (address payable) {
        uint256 nonce = rotationNonces[node];
        uint256 epoch = block.timestamp / EPOCH_SECONDS;
        return payable(deriveAddress(node, nonce, epoch));
    }

    function text(bytes32 node, string memory key) public view returns (string memory) {
        return textRecords[node][key];
    }

    /// @notice Engine-controlled metadata updates (deposit address, receipts, etc.).
    function setText(bytes32 node, string calldata key, string calldata value)
        external
        onlyEngine
    {
        textRecords[node][key] = value;
        emit TextRecordUpdated(node, key, value);
    }

    /// @notice Increment nonce to rotate the derived address.
    function rotateAddress(bytes32 node) external onlyEngine {
        rotationNonces[node] += 1;
        emit AddressRotated(node, rotationNonces[node]);
    }

    function isCurrentSessionAddress(bytes32 node, address candidate)
        external
        view
        returns (bool)
    {
        uint256 nonce = rotationNonces[node];
        uint256 epoch = block.timestamp / EPOCH_SECONDS;
        return deriveAddress(node, nonce, epoch) == candidate;
    }

    function deriveAddress(bytes32 node, uint256 nonce, uint256 epoch)
        internal
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(node, nonce, epoch)))));
    }
}
