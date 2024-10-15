import { Injectable, Inject, Logger } from '@nestjs/common';
import { ID, isGraphQlErrorResult, JobQueue, JobQueueService, Order, OrderService, Product, ProductService, ProductVariant, ProductVariantService, Refund, RequestContext, SerializedRequestContext, TransactionalConnection } from '@vendure/core';
import { loggerCtx } from '../constants';
import { Not, IsNull } from 'typeorm';

@Injectable()
export class VariantHideService {
    constructor(
        private connection: TransactionalConnection,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private orderService: OrderService,
        private jobQueueService: JobQueueService,
    ) { }

    private deletedProductOrderQueue: JobQueue<{
        ctx: SerializedRequestContext,
        productID: ID
    }>;

    async onModuleInit() {
        this.deletedProductOrderQueue = await this.jobQueueService.createQueue({
            name: 'deleted-product-order-queue',
            process: async job => {
                const ctx = RequestContext.deserialize(job.data.ctx);
                await this.handleProductDeletion(ctx, job.data.productID);
            }
        });
    }

    async addToDeletedProductOrderQueue(ctx: RequestContext, productID: ID) {
        this.deletedProductOrderQueue.add({
            ctx: ctx.serialize(),
            productID,
        });
    }

    async autoUpdateVariant(ctx: RequestContext, id: ID) {
        const product = await this.productService.findOne(ctx, id, [
            'variants',
            'assets',
            'featuredAsset',
        ]);
        if (!product) {
            Logger.error(`Product with id ${id} not found or deleted`, loggerCtx);
            return;
        }
        Logger.log(`Updating variant for product ${product.name}`, loggerCtx);
        await this.productVariantService.update(ctx, [{
            id: product.variants[0].id,
            translations: [
                {
                    languageCode: product.translations[0].languageCode,
                    name: product.name,
                }
            ],
            enabled: product.enabled,
            sku: product.name.replace(/\s/g, '-').toLowerCase(),
            assetIds: product.assets.map(asset => asset.assetId),
            featuredAssetId: product.featuredAsset ? product.featuredAsset.id : undefined,
        }]);
    }

    async updateVariant(ctx: RequestContext, variantIDs: ID[]) {
        for (const variantID of variantIDs) {
            const variant = await this.productVariantService.findOne(ctx, variantID, [
                'product',
                'product.assets',
                'product.featuredAsset',
            ]);
            if (!variant) {
                Logger.error(`ProductVariant with id ${variantID} not found or deleted`, loggerCtx);
                return;
            }
            if (!variant.product) {
                Logger.error(`ProductVariant with id ${variantID} does not have a product`, loggerCtx);
                return;
            }
            Logger.log(`Updating variant for product ${variant.name}`, loggerCtx);
            await this.productVariantService.update(ctx, [{
                id: variant.id,
                translations: [
                    {
                        languageCode: variant.product.translations[0].languageCode,
                        name: variant.product.name,
                    }
                ],
                enabled: variant.product.enabled,
                sku: variant.product.name.replace(/\s/g, '-').toLowerCase(),
                assetIds: variant.product.assets.map(asset => asset.assetId),
                featuredAssetId: variant.product.featuredAsset ? variant.product.featuredAsset.id : undefined,
            }]);
        }
    }

    async handleProductDeletion(ctx: RequestContext, productID: ID) {
        try {
            const product = await this.connection.getRepository(ctx, Product).findOne({
                where: {
                    id: productID,
                    deletedAt: Not(IsNull()),
                }
            })
            if (!product) {
                Logger.error(`Product with id ${productID} not deleted yet or found in database`, loggerCtx);
                return;
            }
            Logger.log(`Deleting product with id ${product.id} from all orders`, loggerCtx);
            const productName = product.translations?.[0]?.name || '';
            const orders = await this.connection.getRepository(ctx, Order).
                createQueryBuilder('order').
                leftJoin('order.channels', 'channel').
                leftJoinAndSelect('order.lines', 'line').
                leftJoinAndSelect('line.productVariant', 'productVariant').
                leftJoinAndSelect('productVariant.product', 'product').
                leftJoinAndSelect('order.payments', 'payment').
                where('channel.id = :channelId', { channelId: ctx.channelId }).
                where('product.id = :productId', { productId: product.id }).
                andWhere('order.state IN (:...states)', {
                    states: [
                        'Created',
                        'Draft',
                        'AddingItems',
                        'ArrangingPayment',
                        'PaymentAuthorized',
                        'PaymentSettled',
                    ]
                }).
                getMany();
            const toRefundShippingOrders = [];
            for (const order of orders) {
                const lines = order.lines;
                if (lines.length === 0) {
                    continue;
                }
                let transition = false;

                if (order.state === 'ArrangingPayment') {
                    transition = true;
                    await this.orderService.transitionToState(ctx, order.id, 'AddingItems');
                }
                for (const line of lines) {
                    Logger.log(`Removing product with id ${product.id} from order with id ${order.id}`, loggerCtx);
                    await this.orderService.removeItemFromOrder(ctx, order.id, line.id);
                }
                if (transition) {
                    await this.orderService.transitionToState(ctx, order.id, 'ArrangingPayment');
                }

                if (order.state === "PaymentAuthorized" || order.state === "PaymentSettled") {

                    Logger.log(`Refunding order with id ${order.id} due to product deletion`, loggerCtx);

                    const cancelledOrder = await this.orderService.cancelOrder(ctx, {
                        orderId: order.id,
                        lines: lines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                        reason: `Product ${productName} deleted`,
                    });

                    if (isGraphQlErrorResult(cancelledOrder)) {
                        Logger.log(`Error cancelling order with id ${order.id} due to product deletion: ${cancelledOrder}`, loggerCtx);
                        continue;
                    }

                    const refundedOrder = await this.orderService.refundOrder(ctx, {
                        lines: lines.map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                        reason: `Product ${productName} deleted`,
                        paymentId: order.payments[0].id,
                        shipping: 0,
                        adjustment: 0
                    });

                    if (!isGraphQlErrorResult(refundedOrder)) {
                        if (refundedOrder.state != "Settled") {
                            const refundID = refundedOrder.id;
                            await this.orderService.settleRefund(ctx, {
                                id: refundID,
                                transactionId: order.payments[0].id.toString(),
                            });
                        }
                    }

                    const getOrderState = await this.orderService.findOne(ctx, order.id, [
                        'lines',
                        'payments',
                        'payments.order',
                        'shippingLines'
                    ]);
                    if (getOrderState?.state === 'Cancelled') {
                        toRefundShippingOrders.push(getOrderState);
                    }
                }
            }

            console.log(toRefundShippingOrders.map(order => order.id));

            if (toRefundShippingOrders.length > 0) {
                let uniqueOrders = toRefundShippingOrders.filter((order, index, self) =>
                    index === self.findIndex((t) => (
                        t.id === order.id
                    ))
                );
                for (const order of uniqueOrders) {
                    //Refund from stripe API
                    const shippingCost = order.shippingWithTax;
                    const findExistingRefund = await this.connection.getRepository(ctx, Refund).findOne({
                        where: {
                            transactionId: order.id.toString(),
                        }
                    });
                    if(findExistingRefund){
                        continue;
                    }
                    const refund = new Refund({
                        items: 0,
                        total: shippingCost,
                        reason: `Final product ${productName} deleted - Shipping cost refund`,
                        state: 'Settled',
                        paymentId: order.payments[0].id,
                        transactionId: order.id.toString(),
                        method: 'manual',
                        metadata: {},
                        shipping: shippingCost,
                        adjustment: 0,
                    });
                    await this.connection.getRepository(ctx, Refund).save(refund);
                    await this.orderService.addNoteToOrder(ctx, {
                        id: order.id,
                        note: `Refunding shipping cost ${shippingCost / 100} due to product deletion`,
                        isPublic: false,
                    })
                }
            }

        } catch (error) {
            Logger.error(`Error deleting product with id ${productID} from all orders: ${error}`, loggerCtx);
        }

    }
}
