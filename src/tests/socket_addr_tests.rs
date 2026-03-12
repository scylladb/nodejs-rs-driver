use crate::types::type_helpers::SocketAddrWrapper;

#[napi]
pub fn tests_socket_addr_wrapper(socket_addr: SocketAddrWrapper, case_id: i32) {
    let socket = socket_addr.into_inner();

    match case_id {
        // IPv4 with port 8080
        1 => {
            assert_eq!(socket.ip().to_string(), "127.0.0.1");
            assert_eq!(socket.port(), 8080);
        }
        // IPv4 with port 9042
        2 => {
            assert_eq!(socket.ip().to_string(), "192.168.1.1");
            assert_eq!(socket.port(), 9042);
        }
        // IPv6 with port 7000
        3 => {
            assert_eq!(socket.ip().to_string(), "::1");
            assert_eq!(socket.port(), 7000);
        }
        // IPv6 full address with port 3000
        4 => {
            assert_eq!(
                socket.ip().to_string(),
                "2001:db8:3333:4444:cccc:dddd:eeee:ffff"
            );
            assert_eq!(socket.port(), 3000);
        }
        // IPv4 0.0.0.0 with port 0
        5 => {
            assert_eq!(socket.ip().to_string(), "0.0.0.0");
            assert_eq!(socket.port(), 0);
        }
        // IPv6 :: with port 65535
        6 => {
            assert_eq!(socket.ip().to_string(), "::");
            assert_eq!(socket.port(), 65535);
        }
        _ => unimplemented!("Unexpected test kind: {}", case_id),
    }
}
