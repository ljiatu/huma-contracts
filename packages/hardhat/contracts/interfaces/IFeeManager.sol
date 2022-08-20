//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;
import "../libraries/BaseStructs.sol";

interface IFeeManager {
    function calcFrontLoadingFee(uint256 _amount)
        external
        returns (uint256 fees);

    function calcLateFee(
        uint256 _amount,
        uint256 _dueDate,
        uint256 _lastLateFeeDate,
        uint256 _paymentInterval
    ) external returns (uint256 fees);

    function distBorrowingAmount(uint256 borrowAmount, address humaConfig)
        external
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        );

    function getNextPayment(
        BaseStructs.CreditRecord memory _cr,
        uint256 _lastLateFeeDate,
        uint256 _paymentAmount
    )
        external
        returns (
            uint256,
            uint256,
            uint256,
            bool
        );

    function getFixedPaymentAmount(
        uint256 creditAmt,
        uint256 aprInBps,
        uint256 numOfPayments
    ) external view returns (uint256 paymentAmount);

    function getFees()
        external
        view
        returns (
            uint256 front_loading_fee_flat,
            uint256 front_loading_fee_bps,
            uint256 late_fee_flat,
            uint256 late_fee_bps,
            uint256 unused1,
            uint256 unused2
        );
}
