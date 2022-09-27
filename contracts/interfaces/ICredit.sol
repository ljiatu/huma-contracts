//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICredit {
    function requestCredit(
        uint256 _borrowAmount,
        uint256 _intervalInDays,
        uint256 _numOfPayments
    ) external;

    function approveCredit(address borrower) external;

    function drawdown(uint256 _borrowAmount) external;

    function drawdownWithReceivable(
        address _borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) external;

    function changeCreditLine(address _borrower, uint256 newLine) external;

    function makePayment(
        address _borrower,
        address _asset,
        uint256 _amount
    ) external returns (uint256 amountPaid);

    function triggerDefault(address borrower) external returns (uint256 losses);

    // function assessLateFee(address borrower) external returns (uint256 fees);

    // function assessEarlyPayoffFees(address borrower)
    //     external
    //     returns (uint256 fees);

    // function getNextPayment(address borrower)
    //     external
    //     returns (
    //         uint256 totalAmount,
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         uint256 dueDate
    //     );

    function isApproved(address borrower) external view returns (bool);
}
