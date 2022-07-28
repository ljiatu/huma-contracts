/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

const getInvoiceContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaInvoiceFactoring", address, signer);
};

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
//
// The full testing scenario is designed as:
// 1. Lender contributes 300, together with owner's 100, the pool size is 400
// 2. Factoring fee is 10 flat and 100 bps. Protocol fee is 50 bps.
// 3. Borrower borrows 400. 14 fee charged (2 to treasury, 12 to the pool). Borrower get 386
// 4. Payback 500. The 100 extra will be transferred to the borrower, led to a balance of 486.
// 5. Owner balance becomes 103 with rounding error, lender balance becomes 309 with rounding error.
describe("Huma Invoice Financing", function () {
    let humaPoolAdminsContract;
    let humaPoolFactoryContract;
    let humaPoolContract;
    let humaConfigContract;
    let humaCreditFactoryContract;
    let humaPoolLockerFactoryContract;
    let humaAPIClientContract;
    let testTokenContract;
    let invoiceNFTContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let creditApprover;

    before(async function () {
        [owner, lender, borrower, treasury, creditApprover, payer] =
            await ethers.getSigners();

        const HumaPoolAdmins = await ethers.getContractFactory(
            "HumaPoolAdmins"
        );
        humaPoolAdminsContract = await HumaPoolAdmins.deploy();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(
            owner.address,
            owner.address
        );
        humaConfigContract.setHumaTreasury(treasury.address);

        const HumaCreditFactory = await ethers.getContractFactory(
            "HumaCreditFactory"
        );
        humaCreditFactoryContract = await HumaCreditFactory.deploy();

        const HumaPoolLockerFactory = await ethers.getContractFactory(
            "HumaPoolLockerFactory"
        );
        humaPoolLockerFactoryContract = await HumaPoolLockerFactory.deploy();

        const HumaAPIClient = await ethers.getContractFactory("HumaAPIClient");
        humaAPIClientContract = await HumaAPIClient.deploy();

        const ReputationTrackerFactory = await ethers.getContractFactory(
            "ReputationTrackerFactory"
        );
        reputationTrackerFactoryContract =
            await ReputationTrackerFactory.deploy();

        const HumaPoolFactory = await ethers.getContractFactory(
            "HumaPoolFactory"
        );
        humaPoolFactoryContract = await HumaPoolFactory.deploy(
            humaPoolAdminsContract.address,
            humaConfigContract.address,
            humaCreditFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            humaAPIClientContract.address,
            reputationTrackerFactoryContract.address
        );

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy();
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        // Deploy a InvoiceFactoring pool
        await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
        const tx = await humaPoolFactoryContract.deployNewPool(
            testTokenContract.address,
            1
        );
        const receipt = await tx.wait();
        let poolAddress;
        // eslint-disable-next-line no-restricted-syntax
        for (const evt of receipt.events) {
            if (evt.event === "PoolDeployed") {
                poolAddress = evt.args[0];
            }
        }

        humaPoolContract = await ethers.getContractAt(
            "HumaPool",
            poolAddress,
            owner
        );

        await testTokenContract.approve(humaPoolContract.address, 100);

        await humaPoolContract.makeInitialDeposit(100);
        await humaPoolContract.enablePool();

        const lenderInfo = await humaPoolContract
            .connect(owner)
            .getLenderInfo(owner.address);
        expect(lenderInfo.amount).to.equal(100);
        expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);
        expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);

        await humaPoolContract.addCreditApprover(creditApprover.address);

        await humaPoolContract.setInterestRateBasis(1200); //bps
        await humaPoolContract.setMinMaxBorrowAmt(10, 1000);
        // set fees (factoring_fat, factoring_bps, late_flat, late_bps, early_falt, early_bps)
        await humaPoolContract.setFees(10, 100, 20, 100, 30, 100);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(humaPoolContract.address, 400);

        let lenderBalance = await testTokenContract.balanceOf(lender.address);
        if (lenderBalance < 1000)
            await testTokenContract.mint(lender.address, 1000 - lenderBalance);

        let borrowerBalance = await testTokenContract.balanceOf(
            borrower.address
        );
        if (lenderBalance > 0)
            await testTokenContract
                .connect(borrower)
                .burn(borrower.address, borrowerBalance);
    });

    describe("Post Approved Invoice Factoring", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(300);
            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 99999);
        });

        afterEach(async function () {
            await humaConfigContract.setProtocolPaused(false);
        });

        it("Should only allow credit approvers to post approved loan requests", async function () {
            await expect(
                humaPoolContract
                    .connect(lender)
                    .postApprovedCreditRequest(borrower.address, 400, 30, 1)
            ).to.be.revertedWith("HumaPool:ILLEGAL_CREDIT_POSTER");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            await humaConfigContract.setProtocolPaused(true);
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 400, 30, 1)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await humaPoolContract.disablePool();
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 400, 30, 1)
            ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
        });

        it("Cannot post approved loan with amount lower than limit", async function () {
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 5, 30, 1)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_SMALLER_THAN_LIMIT");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 9999, 30, 1)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_GREATER_THAN_LIMIT");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await humaPoolContract.connect(owner).setInterestRateBasis(1200);

            await humaPoolContract
                .connect(creditApprover)
                .postApprovedCreditRequest(borrower.address, 400, 30, 1);

            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );

            const invoiceContract = await getInvoiceContractFromAddress(
                loanAddress,
                borrower
            );

            const invoiceInfo = await invoiceContract.getInvoiceInfo();

            expect(invoiceInfo._amount).to.equal(400);
        });
    });

    describe("Invoice Factoring Funding", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(300);

            await humaPoolContract
                .connect(creditApprover)
                .postApprovedCreditRequest(borrower.address, 400, 30, 1);
        });

        afterEach(async function () {
            await humaConfigContract.setProtocolPaused(false);
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.setProtocolPaused(true);
            await expect(
                humaPoolContract.connect(borrower).originateCredit(400)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

        // todo This test throw VM Exception. More investigation needed
        it("Prevent loan funding before approval", async function () {
            // expect(
            //     await humaPoolContract.connect(borrower).originateCredit()
            // ).to.be.revertedWith("HumaPool:CREDIT_NOT_APPROVED");
        });

        it.only("Should be able to borrow amount less than approved", async function () {
            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );
            const invoiceContract = await getInvoiceContractFromAddress(
                loanAddress,
                borrower
            );
            await invoiceContract.approve();
            // expect(await invoiceContract.isApproved()).to.equal(true);

            const nftTokenId = await invoiceNFTContract.mintNFT(
                borrower.address,
                ""
            );

            console.log("in test, nftTokenId=", nftTokenId);

            console.log(
                "In test, invoiceNFTContract.address=",
                invoiceNFTContract.address
            );

            await humaPoolContract
                .connect(borrower)
                .originateCreditWithCollateral(
                    200,
                    invoiceNFTContract.address,
                    nftTokenId,
                    1
                );

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(188); // borrower: 188, pool: 11, protocol: 1

            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(1);

            expect(await humaPoolContract.getPoolLiquidity()).to.equal(211);
        });

        it("Should be able to borrow the full approved amount", async function () {
            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );
            const invoiceContract = await getInvoiceContractFromAddress(
                loanAddress,
                borrower
            );
            await invoiceContract.approve();
            // expect(await invoiceContract.isApproved()).to.equal(true);

            let nftTokenId = await invoiceNFTContract.mintNFT(
                borrower.address,
                ""
            );
            await humaPoolContract
                .connect(borrower)
                .originateCreditWithCollateral(
                    400,
                    invoiceNFTContract.address,
                    nftTokenId,
                    1
                );

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(386); // principal: 400, flat fee: 20, bps fee: 4

            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);

            expect(await humaPoolContract.getPoolLiquidity()).to.equal(12);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(300);
            await humaPoolContract.connect(owner).setFees(10, 100, 0, 0, 0, 0);
            await humaPoolContract
                .connect(creditApprover)
                .postApprovedCreditRequest(borrower.address, 400, 30, 1);

            loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );
            invoiceContract = await getInvoiceContractFromAddress(
                loanAddress,
                borrower
            );
            await invoiceContract.approve();
            let nftTokenId = await invoiceNFTContract.mintNFT(
                borrower.address,
                ""
            );
            await humaPoolContract
                .connect(borrower)
                .originateCreditWithCollateral(
                    400,
                    invoiceNFTContract.address,
                    nftTokenId,
                    1
                );

            await testTokenContract.give1000To(payer.address);
        });

        afterEach(async function () {
            await humaConfigContract.setProtocolPaused(false);
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.setProtocolPaused(true);
            await expect(
                invoiceContract
                    .connect(borrower)
                    .makePayment(testTokenContract.address, 5)
            ).to.be.revertedWith("HumaLoan:PROTOCOL_PAUSED");
        });

        // todo if the pool is stopped, shall we accept payback?

        it("Process payback", async function () {
            await ethers.provider.send("evm_increaseTime", [
                30 * 24 * 3600 - 10,
            ]);

            // await testTokenContract
            //     .connect(payer)
            //     .transfer(
            //         HumaPoolLocker(humaPoolContract.getPoolLiquidity()),
            //         210
            //     );

            // await testTokenContract
            //     .connect(borrower)
            //     .approve(humaPoolContract.getPoolLockerAddress(), 210);

            await testTokenContract
                .connect(payer)
                .transfer(humaPoolContract.getPoolLockerAddress(), 500);

            await invoiceContract
                .connect(borrower)
                .makePayment(testTokenContract.address, 500);

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(486);
            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);
            expect(await humaPoolContract.getPoolLiquidity()).to.equal(412);

            // test withdraw to make sure the income is allocated properly.
            expect(await humaPoolContract.balanceOf(lender.address)).to.equal(
                300
            );
            expect(
                await humaPoolContract.withdrawableFundsOf(lender.address)
            ).to.be.within(308, 310); // use within to handle rounding error
            expect(
                await humaPoolContract.withdrawableFundsOf(owner.address)
            ).to.be.within(102, 104); // use within to handle rounding error
        });

        it("Default flow", async function () {
            await expect(invoiceContract.triggerDefault()).to.be.revertedWith(
                "HumaIF:DEFAULT_TRIGGERED_TOO_EARLY"
            );
            const invoiceInfo = await invoiceContract.getInvoiceInfo();
            let gracePeriod =
                await humaPoolContract.getPoolDefaultGracePeriod();
            let dueDate = invoiceInfo._dueDate;
            let current = Date.now();

            let timeNeeded = dueDate + gracePeriod - current;

            await ethers.provider.send("evm_increaseTime", [timeNeeded]);

            await invoiceContract.triggerDefault();

            expect(
                await humaPoolContract.withdrawableFundsOf(owner.address)
            ).to.be.within(2, 4);
            expect(
                await humaPoolContract.withdrawableFundsOf(lender.address)
            ).to.be.within(8, 10);
        });
    });
});
