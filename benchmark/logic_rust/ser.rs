use scylla::{client::caching_session::CachingSession, statement::Statement};

mod common;

const DEFAULT_CACHE_SIZE: u32 = 512;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: i32 = common::get_cnt();

    let session = common::init_deser_table().await?;

    let session: CachingSession = CachingSession::from(session, DEFAULT_CACHE_SIZE as usize);

    let insert_query =
        "INSERT INTO benchmarks.basic (id, val, tuuid, ip, date, time) VALUES (?, ?, ?, ?, ?, ?)";

    for _ in 0..n * n {
        // use CachingSession as it is used in the scylla-javascript-driver
        let statement: Statement = insert_query.into();
        let prepared = session.add_prepared_statement(&statement).await?;

        session
            .get_session()
            .execute_unpaged(&prepared, common::get_deser_data())
            .await?;
    }

    Ok(())
}
