export const ListingStatus = {
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
    PAUSED: 'PAUSED',
    RESERVED: 'RESERVED',
    SOLD: 'SOLD',
    CANCELLED: 'CANCELLED'
};

export const OrderStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED'
};

export const ReservationStatus = {
    ACTIVE: 'ACTIVE',
    RELEASED: 'RELEASED',
    EXPIRED: 'EXPIRED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
};

export const PaymentMethod = {
    COD: 'COD',
    ONLINE: 'ONLINE'
};

export const UserRole = {
    INDIVIDUAL: 'individual',
    WAREHOUSE: 'warehouse',
    COMPANY: 'company',
    ADMIN: 'admin',
    COLLECTOR: 'collector'
};

export const VerificationStatus = {
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED',
    BLOCKED: 'BLOCKED',
    SUSPENDED: 'SUSPENDED'
};

export const KycStage = {
    REGISTERED: 'REGISTERED',
    DOCUMENTS_UPLOADED: 'DOCUMENTS_UPLOADED',
    VERIFIED: 'VERIFIED'
};

export const ItemStatus = {
    AVAILABLE: 'AVAILABLE',
    SOLD: 'SOLD',
    REMOVED: 'REMOVED'
};

export const TransactionStatus = {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
};
