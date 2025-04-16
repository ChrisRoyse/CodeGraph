#!/bin/bash
set -e

# Wait for RabbitMQ to be fully started
until rabbitmqctl status; do
  echo "RabbitMQ is not ready yet - waiting..."
  sleep 5
done

echo "RabbitMQ is up - setting up exchanges and queues"

# Install rabbitmqadmin if not already installed
if [ ! -f /usr/local/bin/rabbitmqadmin ]; then
  echo "Installing rabbitmqadmin..."
  wget -q -O /usr/local/bin/rabbitmqadmin http://localhost:15672/cli/rabbitmqadmin
  chmod +x /usr/local/bin/rabbitmqadmin
fi

# Create exchanges
rabbitmqadmin declare exchange name=bmcp.events.filesystem type=topic durable=true
rabbitmqadmin declare exchange name=bmcp.jobs.analysis type=topic durable=true
rabbitmqadmin declare exchange name=bmcp.results.analysis type=topic durable=true

# Create queues
rabbitmqadmin declare queue name=bmcp.events.filesystem durable=true
rabbitmqadmin declare queue name=bmcp.jobs.analysis durable=true
rabbitmqadmin declare queue name=bmcp.results.analysis durable=true

# Bind queues to exchanges
rabbitmqadmin declare binding source=bmcp.events.filesystem destination=bmcp.events.filesystem destination_type=queue routing_key="#"
rabbitmqadmin declare binding source=bmcp.jobs.analysis destination=bmcp.jobs.analysis destination_type=queue routing_key="#"
rabbitmqadmin declare binding source=bmcp.results.analysis destination=bmcp.results.analysis destination_type=queue routing_key="#"

echo "RabbitMQ setup completed successfully"