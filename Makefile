# Brings the test clusters up and down.
#
# The examples talk to a cluster over the network, and these targets start the same ones
# CI does: a 3-node ScyllaDB and a 3-node Apache Cassandra, on separate docker networks so
# they can run at once. Neither publishes a host port, so they also do not collide with the
# CCM clusters the integration tests start on 127.0.0.x.
#
#   make up            start both clusters and wait for them to be ready
#   make examples      run the examples against both (implies `up`)
#   make down          stop and remove both
#   make ccm-clean     clear CCM clusters a failed integration run left running
#
# Docker needs root here; override with `make COMPOSE="docker compose" up` where it
# does not.

COMPOSE ?= sudo docker compose

SCYLLA_COMPOSE := .github/docker-compose.yml
CASSANDRA_COMPOSE := .github/docker-compose-cassandra.yml

# The examples read whichever address they are given from SCYLLA_URI, so the Cassandra
# run is handed its own address under that same name.
SCYLLA_ADDR := 172.42.0.2:9042
CASSANDRA_ADDR := 172.43.0.2:9042

.PHONY: up down stop logs examples examples-scylla examples-cassandra \
        scylla-up scylla-down cassandra-up cassandra-down ccm-clean

up: scylla-up cassandra-up

down: scylla-down cassandra-down

# Leaves the containers in place so `make logs` still works after a failure.
stop:
	-$(COMPOSE) -f $(SCYLLA_COMPOSE) stop
	-$(COMPOSE) -f $(CASSANDRA_COMPOSE) stop

logs:
	-$(COMPOSE) -f $(SCYLLA_COMPOSE) logs
	-$(COMPOSE) -f $(CASSANDRA_COMPOSE) logs

scylla-up:
	$(COMPOSE) -f $(SCYLLA_COMPOSE) up -d --wait

# Cassandra bootstraps one node at a time, so this waits noticeably longer than Scylla.
cassandra-up:
	$(COMPOSE) -f $(CASSANDRA_COMPOSE) up -d --wait

scylla-down:
	-$(COMPOSE) -f $(SCYLLA_COMPOSE) down

cassandra-down:
	-$(COMPOSE) -f $(CASSANDRA_COMPOSE) down

examples: up examples-scylla examples-cassandra

examples-scylla:
	cd examples && npm i
	SCYLLA_URI=$(SCYLLA_ADDR) npm run examples

# Cassandra 4.1 has no vector type, so those examples are left out.
examples-cassandra:
	cd examples && npm i
	SCYLLA_URI=$(CASSANDRA_ADDR) SKIP_VECTOR_EXAMPLES=true npm run examples

# A suite whose `before all` fails never reaches its teardown, so its CCM nodes keep
# running and hold 127.0.0.1:7000, and every later run fails to start a cluster. CCM
# cannot clear that itself - it reads node state from its own config rather than from the
# process, so it reports the nodes down, `ccm stop` does nothing and `ccm remove` deletes
# the directory while the processes live on. Go by what actually holds the ports, and drop
# the state only once nothing is listening.
ccm-clean:
	@killed=0; \
	  for pid in $$(ss -lntp 2>/dev/null \
	                | grep -oE '127\.0\.0\.[0-9]+:(7000|9042).*pid=[0-9]+' \
	                | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do \
	    exe=$$(readlink /proc/$$pid/exe 2>/dev/null); \
	    case "$$exe" in \
	      */bin/java|*/bin/scylla) kill $$pid && echo "  stopped node $$pid" && killed=1 ;; \
	      *) echo "  pid $$pid ($$exe) holds a CCM port but is not a node - left alone" >&2 ;; \
	    esac; \
	  done; \
	  if [ $$killed -eq 1 ]; then \
	    for _ in $$(seq 1 20); do \
	      ss -lnt | grep -qE ':(7000|9042)' || break; sleep 2; \
	    done; \
	  fi; \
	  if ss -lnt | grep -qE ':(7000|9042)'; then \
	    echo "  still listening on 7000/9042 - leaving ~/.ccm alone" >&2; \
	    ss -lntp 2>/dev/null | grep -E ':(7000|9042)' >&2; exit 1; \
	  fi; \
	  rm -rf "$$HOME"/.ccm/test* "$$HOME"/.ccm/CURRENT; \
	  echo "  cleared"
