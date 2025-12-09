use scylla::statement::Statement;
use uuid::Uuid;

mod common;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: i32 = common::get_cnt();

    let session = common::init_simple_table_caching().await?;

    let insert_query = "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";

    for _ in 0..n {
        // use CachingSession as it is used in the scylla-javascript-driver
        let statement: Statement = insert_query.into();
        let prepared = session.add_prepared_statement(&statement).await?;

        let id = Uuid::new_v4();
        session
            .get_session()
            .execute_unpaged(&prepared, (id, 100))
            .await?;
    }

    Ok(())
}
