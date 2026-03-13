// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ENSIP-10 extended resolver interface (wildcard resolution).
interface IExtendedResolver {
    /// @dev See ENSIP-10: https://docs.ens.domains/ensip/10/
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory);
}
