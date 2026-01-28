import { Client, EmptyCallback, ExecutionOptions, Host, HostMap } from "../../";
import { types } from "../types";

export namespace policies {
  function defaultAddressTranslator(): addressResolution.AddressTranslator;

  function defaultLoadBalancingPolicy(
    localDc?: string,
  ): loadBalancing.LoadBalancingPolicy;

  function defaultReconnectionPolicy(): reconnection.ReconnectionPolicy;

  function defaultRetryPolicy(): retry.RetryPolicy;

  function defaultSpeculativeExecutionPolicy(): speculativeExecution.SpeculativeExecutionPolicy;

  function defaultTimestampGenerator(): timestampGeneration.TimestampGenerator;

  namespace addressResolution {
    interface AddressTranslator {
      translate(address: string, port: number, callback: Function): void;
    }

    class EC2MultiRegionTranslator implements AddressTranslator {
      translate(address: string, port: number, callback: Function): void;
    }
  }

  namespace loadBalancing {
    abstract class LoadBalancingPolicy {
      init(client: Client, hosts: HostMap, callback: EmptyCallback): void;

      getDistance(host: Host): types.distance;

      newQueryPlan(
        keyspace: string,
        executionOptions: ExecutionOptions,
        callback: (error: Error, iterator: Iterator<Host>) => void,
      ): void;

      getOptions(): Map<string, object>;
    }

    class DCAwareRoundRobinPolicy extends LoadBalancingPolicy {
      constructor(localDc: string);
    }

    class TokenAwarePolicy extends LoadBalancingPolicy {
      constructor(childPolicy: LoadBalancingPolicy);
    }

    class AllowListPolicy extends LoadBalancingPolicy {
      constructor(childPolicy: LoadBalancingPolicy, allowList: string[]);
    }

    class RoundRobinPolicy extends LoadBalancingPolicy {
      constructor();
    }

    class LegacyDefaultLoadBalancingPolicy extends LoadBalancingPolicy {
      constructor(options?: {
        localDc?: string;
        filter?: (host: Host) => boolean;
      });
    }
    
    class LoadBalancingConfig {
      preferDatacenter?: string;
      preferRack?: string;
      tokenAware?: boolean;
      permitDcFailover?: boolean;
      enableShufflingReplicas?: boolean;
    }
    
    class DefaultLoadBalancingPolicy extends LoadBalancingPolicy {
      constructor(config?: LoadBalancingConfig);
    }
  }

  namespace reconnection {
    class ConstantReconnectionPolicy implements ReconnectionPolicy {
      constructor(delay: number);

      getOptions(): Map<string, object>;

      newSchedule(): Iterator<number>;
    }

    class ExponentialReconnectionPolicy implements ReconnectionPolicy {
      constructor(
        baseDelay: number,
        maxDelay: number,
        startWithNoDelay?: boolean,
      );

      getOptions(): Map<string, object>;

      newSchedule(): Iterator<number>;
    }

    interface ReconnectionPolicy {
      getOptions(): Map<string, object>;

      newSchedule(): Iterator<number>;
    }
  }

  namespace retry {
    class FallthroughRetryPolicy extends RetryPolicy {
      constructor();
    }

    class RetryPolicy {
      constructor();
    }
  }

  namespace speculativeExecution {
    class ConstantSpeculativeExecutionPolicy
      implements SpeculativeExecutionPolicy
    {
      constructor(delay: number, maxSpeculativeExecutions: number);

      getOptions(): Map<string, object>;

      init(client: Client): void;

      newPlan(
        keyspace: string,
        queryInfo: string | Array<object>,
      ): { nextExecution: Function };

      shutdown(): void;
    }

    class NoSpeculativeExecutionPolicy implements SpeculativeExecutionPolicy {
      constructor();

      getOptions(): Map<string, object>;

      init(client: Client): void;

      newPlan(
        keyspace: string,
        queryInfo: string | Array<object>,
      ): { nextExecution: Function };

      shutdown(): void;
    }

    interface SpeculativeExecutionPolicy {
      getOptions(): Map<string, object>;

      init(client: Client): void;

      newPlan(
        keyspace: string,
        queryInfo: string | Array<object>,
      ): { nextExecution: Function };

      shutdown(): void;
    }
  }

  namespace timestampGeneration {
    class MonotonicTimestampGenerator implements TimestampGenerator {
      constructor(warningThreshold: number, minLogInterval: number);

      getDate(): number;

      next(client: Client): types.Long | number;
    }

    interface TimestampGenerator {
      next(client: Client): types.Long | number;
    }
  }
}
