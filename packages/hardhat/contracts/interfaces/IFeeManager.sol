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
    ) external view returns (uint256 fees);

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
        view
        returns (
            uint256,
            uint256,
            uint256,
            bool,
            bool,
            bool
        );

    function getInstallmentAmount(
        uint256 creditAmt,
        uint256 aprInBps,
        uint256 numOfPayments
    ) external view returns (uint256 paymentAmount);

    function getFees()
        external
        view
        returns (
            uint256 frontLoadingFeeFlat,
            uint256 frontLoadingFeeBps,
            uint256 lateFeeFlat,
            uint256 lateFeeBps,
            uint256 unused1,
            uint256 unused2
        );
}
