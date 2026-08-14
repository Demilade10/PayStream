#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, Env};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let address = sac.address();
    let token_client = token::Client::new(env, &address);
    let admin_client = token::StellarAssetClient::new(env, &address);
    (address, token_client, admin_client)
}

#[test]
fn test_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaystreamContract, ());
    let client = PaystreamContractClient::new(&env, &contract_id);

    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, token_client, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&subscriber, &1_000_000);

    let plan_id = client.create_plan(&merchant, &100, &86400, &token_address);

    // Subscriber approves the contract directly, as its own step, mirroring
    // the real-world flow (this now happens outside subscribe()).
    token_client.approve(&subscriber, &contract_id, &1_000_000, &(env.ledger().sequence() + 3_000_000));

    let sub_id = client.subscribe(&subscriber, &plan_id, &1_000_000);

    env.ledger().with_mut(|li| li.timestamp += 86400);
    client.charge(&sub_id);
    assert_eq!(token_client.balance(&merchant), 100);
    assert_eq!(token_client.balance(&subscriber), 999_900);

    env.ledger().with_mut(|li| li.timestamp += 86400);
    client.charge(&sub_id);
    assert_eq!(token_client.balance(&merchant), 200);
}

#[test]
fn test_charge_before_due_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaystreamContract, ());
    let client = PaystreamContractClient::new(&env, &contract_id);

    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, _token_client, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&subscriber, &1_000_000);

    let plan_id = client.create_plan(&merchant, &100, &86400, &token_address);
    let sub_id = client.subscribe(&subscriber, &plan_id, &1_000_000);

    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::NotYetDue)));
}

#[test]
fn test_charge_after_cancel_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaystreamContract, ());
    let client = PaystreamContractClient::new(&env, &contract_id);

    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, _token_client, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&subscriber, &1_000_000);

    let plan_id = client.create_plan(&merchant, &100, &86400, &token_address);
    let sub_id = client.subscribe(&subscriber, &plan_id, &1_000_000);
    client.cancel(&sub_id);

    env.ledger().with_mut(|li| li.timestamp += 86400);
    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::SubscriptionNotActive)));
}

#[test]
fn test_insufficient_allowance_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaystreamContract, ());
    let client = PaystreamContractClient::new(&env, &contract_id);

    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, _token_client, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&subscriber, &1_000_000);

    let plan_id = client.create_plan(&merchant, &100, &86400, &token_address);
    let sub_id = client.subscribe(&subscriber, &plan_id, &50);

    env.ledger().with_mut(|li| li.timestamp += 86400);
    let result = client.try_charge(&sub_id);
    assert_eq!(result, Err(Ok(Error::InsufficientAllowance)));
}

#[test]
fn test_cancel_requires_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaystreamContract, ());
    let client = PaystreamContractClient::new(&env, &contract_id);

    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, _token_client, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&subscriber, &1_000_000);

    let plan_id = client.create_plan(&merchant, &100, &86400, &token_address);
    let sub_id = client.subscribe(&subscriber, &plan_id, &1_000_000);

    env.set_auths(&[]);
    let result = client.try_cancel(&sub_id);
    assert!(result.is_err());
}
