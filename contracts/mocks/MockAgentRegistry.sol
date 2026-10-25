// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Registry tiruan untuk test: siapa pun yang di-set jadi agent punya balance 1.
contract MockAgentRegistry {
    mapping(address => uint256) public balanceOf;

    function setAgent(address who, uint256 n) external {
        balanceOf[who] = n;
    }
}
