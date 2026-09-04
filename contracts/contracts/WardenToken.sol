// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Warden (WARDEN)
/// @notice Fixed-supply BEP-20 community token for the Warden trading agent.
/// The entire supply is minted once, here, to the deployer. There is no
/// owner, no mint/burn-by-admin, no fee-on-transfer, no blacklist, no pause —
/// nothing beyond plain ERC20. Anyone reading the source has the whole
/// picture; there is no further admin surface to renounce.
contract WardenToken is ERC20 {
    constructor(address initialHolder, uint256 totalSupply_) ERC20("Warden", "WARDEN") {
        _mint(initialHolder, totalSupply_);
    }
}
