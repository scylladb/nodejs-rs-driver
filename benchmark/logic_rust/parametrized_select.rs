use scylla::{statement::Statement, value::Row};
use uuid::Uuid;

use crate::common;

pub async fn parametrized_select_benchmark(
    num_of_rows: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    let n: i32 = common::get_cnt();

    let session = common::init_simple_table_caching().await?;

    let insert_query = "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";
    for _ in 0..num_of_rows {
        // use CachingSession as it is used in the scylla-javascript-driver
        let statement: Statement = insert_query.into();
        let prepared = session.add_prepared_statement(&statement).await?;

        let id = Uuid::new_v4();
        session
            .get_session()
            .execute_unpaged(&prepared, (id, 100))
            .await?;
    }

    let select_query = "SELECT * FROM benchmarks.basic";
    for _ in 0..n {
        let s = Statement::new(select_query).with_page_size(num_of_rows);
        let r = session
            .execute_unpaged(s, &[])
            .await?
            .into_rows_result()?
            .rows::<Row>()?
            .collect::<Vec<_>>();
        // println!("Selected {} rows", r.len());
        assert_eq!(r.len() as i32, num_of_rows);
    }

    Ok(())
}
