#![no_std]
mod test;

use soroban_sdk::{contract, contracterror, contracttype, contractimpl, token::TokenClient, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    PlanNotFound = 1,
    PlanInactive = 2,
    SubscriptionNotFound = 3,
    SubscriptionNotActive = 4,
    NotYetDue = 5,
    InsufficientAllowance = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct Plan {
    pub merchant: Address,
    pub price: i128,
    pub interval_seconds: u64,
    pub token: Address,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SubStatus {
    Active,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Subscription {
    pub subscriber: Address,
    pub plan_id: u64,
    pub next_due: u64,
    pub status: SubStatus,
    pub allowance_remaining: i128,
}

#[contracttype]
pub enum DataKey {
    Plan(u64),
    Subscription(u64),
    NextPlanId,
    NextSubId,
}

#[contract]
pub struct PaystreamContract;

#[contractimpl]
impl PaystreamContract {
    pub fn get_plan(env: Env, plan_id: u64) -> Result<Plan, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .ok_or(Error::PlanNotFound)
    }

    pub fn get_subscription(env: Env, subscription_id: u64) -> Result<Subscription, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .ok_or(Error::SubscriptionNotFound)
    }

    pub fn create_plan(
        env: Env,
        merchant: Address,
        price: i128,
        interval_seconds: u64,
        token: Address,
    ) -> u64 {
        merchant.require_auth();

        let plan_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextPlanId)
            .unwrap_or(0);

        let plan = Plan {
            merchant,
            price,
            interval_seconds,
            token,
            active: true,
        };

        env.storage().persistent().set(&DataKey::Plan(plan_id), &plan);
        env.storage()
            .persistent()
            .set(&DataKey::NextPlanId, &(plan_id + 1));

        plan_id
    }

    // NOTE: the subscriber must call the token contract's `approve` directly
    // (as their own separate transaction) BEFORE calling subscribe, granting
    // this contract's address an allowance >= their intended payments.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        plan_id: u64,
        allowance: i128,
    ) -> Result<u64, Error> {
        subscriber.require_auth();

        let plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .ok_or(Error::PlanNotFound)?;

        if !plan.active {
            return Err(Error::PlanInactive);
        }

        let sub_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextSubId)
            .unwrap_or(0);

        let subscription = Subscription {
            subscriber,
            plan_id,
            next_due: env.ledger().timestamp() + plan.interval_seconds,
            status: SubStatus::Active,
            allowance_remaining: allowance,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(sub_id), &subscription);
        env.storage()
            .persistent()
            .set(&DataKey::NextSubId, &(sub_id + 1));

        Ok(sub_id)
    }

    pub fn charge(env: Env, subscription_id: u64) -> Result<(), Error> {
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .ok_or(Error::SubscriptionNotFound)?;

        if subscription.status != SubStatus::Active {
            return Err(Error::SubscriptionNotActive);
        }

        if env.ledger().timestamp() < subscription.next_due {
            return Err(Error::NotYetDue);
        }

        let plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(subscription.plan_id))
            .ok_or(Error::PlanNotFound)?;

        if subscription.allowance_remaining < plan.price {
            return Err(Error::InsufficientAllowance);
        }

        let token_client = TokenClient::new(&env, &plan.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &subscription.subscriber,
            &plan.merchant,
            &plan.price,
        );

        subscription.next_due += plan.interval_seconds;
        subscription.allowance_remaining -= plan.price;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &subscription);

        Ok(())
    }

    pub fn cancel(env: Env, subscription_id: u64) -> Result<(), Error> {
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .ok_or(Error::SubscriptionNotFound)?;

        subscription.subscriber.require_auth();

        subscription.status = SubStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &subscription);

        Ok(())
    }
}
