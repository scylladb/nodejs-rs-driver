import { policies } from "../../main";
import LoadBalancingPolicy = policies.loadBalancing.LoadBalancingPolicy;
import TokenAwarePolicy = policies.loadBalancing.TokenAwarePolicy;
import ReconnectionPolicy = policies.reconnection.ReconnectionPolicy;
import RetryPolicy = policies.retry.RetryPolicy;
import ConstantReconnectionPolicy = policies.reconnection.ConstantReconnectionPolicy;
import ExponentialReconnectionPolicy = policies.reconnection.ExponentialReconnectionPolicy;
import addressResolution = policies.addressResolution;

/*
 * TypeScript definitions compilation tests for policy module.
 */

function myTest(): void {
  let lbp: LoadBalancingPolicy;
  let rp: ReconnectionPolicy;
  let retryPolicy: RetryPolicy;

  lbp = new policies.loadBalancing.DCAwareRoundRobinPolicy("dc1");
  lbp = new policies.loadBalancing.AllowListPolicy(lbp, ["a", "b", "c"]);
  lbp = new TokenAwarePolicy(lbp);
  lbp.getOptions();

  // defaultLoadBalancingPolicy method should have an optional string parameter
  lbp = policies.defaultLoadBalancingPolicy("dc1");
  lbp = policies.defaultLoadBalancingPolicy();

  rp = new ConstantReconnectionPolicy(10);
  rp = new ExponentialReconnectionPolicy(1000, 60 * 1000);
  rp.getOptions();

  retryPolicy = new RetryPolicy();

  let ar: addressResolution.AddressTranslator =
    new addressResolution.EC2MultiRegionTranslator();
}
