import { policies } from "../../main";
import LoadBalancingPolicy = policies.loadBalancing.LoadBalancingPolicy;
import TokenAwarePolicy = policies.loadBalancing.TokenAwarePolicy;
import ReconnectionPolicy = policies.reconnection.ReconnectionPolicy;
import RetryPolicy = policies.retry.RetryPolicy;
import ConstantReconnectionPolicy = policies.reconnection.ConstantReconnectionPolicy;
import ExponentialReconnectionPolicy = policies.reconnection.ExponentialReconnectionPolicy;
import SpeculativeExecutionPolicy = policies.speculativeExecution.SpeculativeExecutionPolicy;
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

    const noSpeculativeExecution =
        new policies.speculativeExecution.NoSpeculativeExecutionPolicy();
    const constantSpeculativeExecution =
        new policies.speculativeExecution.ConstantSpeculativeExecutionPolicy(
            100,
            1,
        );
    const batchQueryInfo: Array<object> = [
        { query: "INSERT INTO ks1.table1 (id) VALUES (?)" },
    ];
    let speculativeExecutionPolicy: SpeculativeExecutionPolicy =
        noSpeculativeExecution;

    noSpeculativeExecution.newPlan("ks1", "SELECT * FROM ks1.table1");
    constantSpeculativeExecution.newPlan("ks1", batchQueryInfo);
    speculativeExecutionPolicy.newPlan("ks1", batchQueryInfo);

    let ar: addressResolution.AddressTranslator =
        new addressResolution.EC2MultiRegionTranslator();
}
