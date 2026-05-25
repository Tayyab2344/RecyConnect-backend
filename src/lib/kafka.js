import { Kafka, logLevel } from 'kafkajs';
import { logger } from '../utils/logger.js';

const isEnabled = process.env.KAFKA_ENABLED === 'true';

let kafkaClient = null;
let producer = null;
let consumer = null;
let isProducerHealthy = false;
let isConsumerHealthy = false;
let eventHandler = null;

if (isEnabled) {
    const bootstrapServers = process.env.KAFKA_BOOTSTRAP_SERVERS;
    const apiKey = process.env.KAFKA_API_KEY;
    const apiSecret = process.env.KAFKA_API_SECRET;

    if (!bootstrapServers || !apiKey || !apiSecret) {
        logger.error('[KAFKA] Configuration is missing. Please check KAFKA_BOOTSTRAP_SERVERS, KAFKA_API_KEY, and KAFKA_API_SECRET.');
    } else {
        try {
            kafkaClient = new Kafka({
                clientId: 'recyconnect-backend',
                brokers: [bootstrapServers],
                ssl: true,
                sasl: {
                    mechanism: 'plain',
                    username: apiKey,
                    password: apiSecret
                },
                logCreator: () => ({ level, log }) => {
                    const { message, ...extra } = log;
                    if (level === logLevel.ERROR) {
                        logger.error(`[KAFKA-JS] ${message}`, extra);
                    } else if (level === logLevel.WARN) {
                        logger.warn(`[KAFKA-JS] ${message}`, extra);
                    } else {
                        logger.debug(`[KAFKA-JS] ${message}`, extra);
                    }
                }
            });
        } catch (error) {
            logger.error(`[KAFKA] Failed to initialize Kafka client: ${error.message}`);
        }
    }
}

/**
 * Register handler for incoming Kafka events
 * @param {Function} handler - Callback function of signature (type, payload)
 */
export const registerKafkaEventHandler = (handler) => {
    eventHandler = handler;
};

/**
 * Check if Kafka integration is enabled and healthy
 */
export const isKafkaHealthy = () => {
    return isEnabled && isProducerHealthy && isConsumerHealthy;
};

/**
 * Connect the Kafka Producer to Confluent Cloud
 */
export const initKafka = async () => {
    if (!isEnabled || !kafkaClient) {
        logger.info('[KAFKA] Kafka integration is disabled.');
        return;
    }

    const topic = process.env.KAFKA_TOPIC || 'recyconnect-events';

    try {
        const admin = kafkaClient.admin();
        await admin.connect();
        logger.info('[KAFKA] Admin client connected. Verifying topic presence...');
        const topics = await admin.listTopics();
        if (!topics.includes(topic)) {
            logger.info(`[KAFKA] Topic '${topic}' does not exist on broker. Attempting auto-creation...`);
            await admin.createTopics({
                topics: [{
                    topic,
                    numPartitions: 3,
                    replicationFactor: 3
                }]
            });
            logger.info(`[KAFKA] Topic '${topic}' created successfully.`);
        } else {
            logger.info(`[KAFKA] Topic '${topic}' already exists on Confluent Cloud.`);
        }
        await admin.disconnect();
    } catch (adminError) {
        logger.warn(`[KAFKA] Admin helper could not pre-create/verify topic '${topic}': ${adminError.message}`);
    }

    try {
        producer = kafkaClient.producer();
        await producer.connect();
        isProducerHealthy = true;
        logger.info('[KAFKA] Producer connected successfully to Confluent Cloud.');
    } catch (error) {
        isProducerHealthy = false;
        logger.error(`[KAFKA] Failed to connect producer: ${error.message}`);
    }
};

/**
 * Publish an event to the Kafka topic
 * @param {string} type - The event type/name
 * @param {object} payload - The event payload
 */
export const sendKafkaEvent = async (type, payload) => {
    if (!isEnabled || !producer || !isHealthy) {
        logger.warn(`[KAFKA] Cannot publish event ${type} - Kafka is disabled or unhealthy.`);
        return false;
    }

    const topic = process.env.KAFKA_TOPIC || 'recyconnect-events';
    try {
        const message = {
            key: payload.orderId ? String(payload.orderId) : (payload.listingId ? String(payload.listingId) : null),
            value: JSON.stringify({
                type,
                payload,
                timestamp: new Date().toISOString()
            })
        };

        await producer.send({
            topic,
            messages: [message]
        });
        logger.info(`[KAFKA] Published event ${type} to topic ${topic}.`);
        return true;
    } catch (error) {
        logger.error(`[KAFKA] Failed to publish event ${type}: ${error.message}`);
        return false;
    }
};

/**
 * Connect and run the Kafka Consumer
 */
export const startKafkaConsumer = async () => {
    if (!isEnabled || !kafkaClient) {
        return;
    }

    const group = process.env.KAFKA_CONSUMER_GROUP || 'recyconnect-backend-group';
    const topic = process.env.KAFKA_TOPIC || 'recyconnect-events';

    try {
        consumer = kafkaClient.consumer({ groupId: group });
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: false });
        isConsumerHealthy = true;
        logger.info(`[KAFKA] Consumer connected & subscribed to topic: ${topic}`);

        await consumer.run({
            eachMessage: async ({ topic: msgTopic, partition, message }) => {
                try {
                    const rawValue = message.value?.toString();
                    if (!rawValue) return;

                    const parsed = JSON.parse(rawValue);
                    logger.info(`[KAFKA] Received message on topic ${msgTopic} (partition ${partition}): type=${parsed.type}`);

                    if (eventHandler) {
                        await eventHandler(parsed.type, parsed.payload);
                    } else {
                        logger.warn(`[KAFKA] No event handler registered to process received event: ${parsed.type}`);
                    }
                } catch (err) {
                    logger.error(`[KAFKA] Error processing consumed message: ${err.message}`);
                }
            }
        });
    } catch (error) {
        isConsumerHealthy = false;
        logger.error(`[KAFKA] Failed to start consumer: ${error.message}`);
    }
};

/**
 * Disconnect both Producer and Consumer gracefully
 */
export const disconnectKafka = async () => {
    try {
        if (producer) {
            await producer.disconnect();
            logger.info('[KAFKA] Producer disconnected.');
        }
        if (consumer) {
            await consumer.disconnect();
            logger.info('[KAFKA] Consumer disconnected.');
        }
    } catch (err) {
        logger.error(`[KAFKA] Error during disconnect: ${err.message}`);
    }
};
