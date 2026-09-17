import { Client, Host, Replica, metadata, token, types } from "../../main";
import TableMetadata = metadata.TableMetadata;
import QueryTrace = metadata.QueryTrace;
import KeyspaceMetadata = metadata.KeyspaceMetadata;

/*
 * TypeScript definitions compilation tests for metadata module.
 */

async function myTest(): Promise<any> {
    const client = new Client({
        contactPoints: ["h1", "h2"],
        localDataCenter: "dc1",
    });

    let promise: Promise<void>;
    let n: number;
    let hosts: Host[];
    let token: token.Token;
    let replicas: Replica[];

    promise = client.connect();

    token = client.metadata.newToken(Buffer.from([0]), "ks1", "table1");
    replicas = client.metadata.getReplicas("ks1", "table1", token);
    hosts = replicas.map((replica) => replica.host);
    n = replicas[0].shard;

    const table: TableMetadata | null = client.metadata.getTable(
        "ks1",
        "table1",
    );

    const keyspaces: Readonly<Record<string, KeyspaceMetadata>> =
        client.metadata.getKeyspaces();
    const keyspace: KeyspaceMetadata | null =
        client.metadata.getKeyspace("ks1");

    const trace: QueryTrace = await client.metadata.getTrace(
        types.Uuid.random(),
    );
    client.metadata.getTrace(types.Uuid.random(), (err, t) =>
        useResult<QueryTrace>(err, t),
    );

    hosts = client.getState().getConnectedHosts();
    n = client.getState().getInFlightQueries(hosts[0]);
    n = client.getState().getOpenConnections(hosts[0]);
}

function useResult<T>(err: Error, rs: T): void {
    // Mock function that takes the parameters defined in the driver callback
}
