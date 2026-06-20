import { types, Client } from "../../main";
import Uuid = types.Uuid;
import TimeUuid = types.TimeUuid;
import Long = types.Long;
import BigDecimal = types.BigDecimal;
import InetAddress = types.InetAddress;
import Tuple = types.Tuple;
import ResultSet = types.ResultSet;
import Row = types.Row;

/*
 * TypeScript definitions compilation tests for types module.
 */

async function myTest(): Promise<void> {
    let id: Uuid;
    let tid: TimeUuid;
    let b: boolean;
    let s: string;
    let buffer: Buffer;
    let rs: ResultSet;

    types.protocolVersion.isSupported(types.protocolVersion.v4);

    // logLevels enum
    let ll: types.logLevels;
    ll = types.logLevels.trace;
    ll = types.logLevels.debug;
    ll = types.logLevels.info;
    ll = types.logLevels.warning;
    ll = types.logLevels.error;
    ll = types.logLevels.off;

    id = Uuid.random();

    id = TimeUuid.now();
    tid = TimeUuid.now();

    b = id.equals(tid);

    TimeUuid.now((err, value) => value.getDate() === new Date());

    let dec: BigDecimal = BigDecimal.fromString("123");
    dec = dec.add(new BigDecimal(10, 4)).subtract(dec);

    let address: InetAddress = InetAddress.fromString("127.0.0.1");
    s = address.toString();
    buffer = address.getBuffer();

    let tuple = Tuple.fromArray(["a", 1]);
    b = tuple !== new Tuple("a", 1);

    // Long is an external dependency
    // Use static methods
    let long: Long = Long.fromNumber(2).div(Long.fromString("a")).toUnsigned();
    // Use as an instance
    long.div(long);
    // Use constructor
    long = new Long(1, 2);

    const client = new Client({
        contactPoints: ["host1"],
        localDataCenter: "dc1",
    });

    rs = await client.execute("SELECT * FROM ks1.table1");
    // Test iteration
    for (const row of rs) {
        // Check is of type Row
        const r: Row = row;
    }

    rs = await client.execute("SELECT * FROM ks1.table1");
    // Test async iteration
    for await (const row of rs) {
        // Check is of type Row
        const r: Row = row;
    }
}
