import { Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    FacetValueFormInputComponent,
    JobQueueService,
    JobState,
    LogicalOperator,
    ModalService,
    NotificationService,
    ProductListQueryDocument,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { EMPTY, lastValueFrom } from 'rxjs';
import { delay, switchMap } from 'rxjs/operators';
import { SharedModule } from '@vendure/admin-ui/core';
@Component({
    selector: 'vdr-products-list',
    imports: [SharedModule],
    standalone: true,
    templateUrl: './product-list.component.html',
    styleUrls: ['./product-list.component.scss'],
})
export class ProductListComponent
    extends TypedBaseListComponent<typeof ProductListQueryDocument, 'products'>
    implements OnInit
{
    pendingSearchIndexUpdates = 0;
    readonly customFields = this.getCustomFieldConfig('Product');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilters([
            {
                name: 'enabled',
                type: { kind: 'boolean' },
                label: _('common.enabled'),
                filterField: 'enabled',
            },
            {
                name: 'slug',
                type: { kind: 'text' },
                label: _('common.slug'),
                filterField: 'slug',
            },
        ])
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSorts([
            { name: 'id' },
            { name: 'createdAt' },
            { name: 'updatedAt' },
            { name: 'name' },
            { name: 'slug' },
        ])
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor(
        protected dataService: DataService,
        private modalService: ModalService,
        private notificationService: NotificationService,
        private jobQueueService: JobQueueService,
    ) {
        super();
        this.configure({
            document: ProductListQueryDocument,
            getItems: data => data.products,
            setVariables: (skip, take) => {
                const searchTerm = this.searchTermControl.value;
                let filterInput = this.filters.createFilterInput();
                if (searchTerm) {
                    filterInput = {
                        name: {
                            contains: searchTerm,
                        },
                        sku: {
                            contains: searchTerm,
                        },
                    };
                }
                return {
                    options: {
                        skip,
                        take,
                        filter: {
                            ...(filterInput ?? {}),
                        },
                        filterOperator: searchTerm ? LogicalOperator.OR : LogicalOperator.AND,
                        sort: this.sorts.createSortInput(),
                    },
                };
            },
            refreshListOnChanges: [this.sorts.valueChanges, this.filters.valueChanges],
        });
    }

    rebuildSearchIndex() {
        this.dataService.product.reindex().subscribe(({ reindex }) => {
            this.notificationService.info(_('catalog.reindexing'));
            this.jobQueueService.addJob(reindex.id, job => {
                if (job.state === JobState.COMPLETED) {
                    const time = new Intl.NumberFormat().format(job.duration || 0);
                    this.notificationService.success(_('catalog.reindex-successful'), {
                        count: job.result.indexedItemCount,
                        time,
                    });
                    this.refresh();
                } else {
                    this.notificationService.error(_('catalog.reindex-error'));
                }
            });
        });
    }

    deleteProduct(productId: string) {
        this.modalService
            .dialog({
                title: _('catalog.confirm-delete-product'),
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(response => (response ? this.dataService.product.deleteProduct(productId) : EMPTY)),
                // Short delay to allow the product to be removed from the search index before
                // refreshing.
                delay(500),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-delete-success'), {
                        entity: 'Product',
                    });
                    this.refresh();
                },
                err => {
                    this.notificationService.error(_('common.notify-delete-error'), {
                        entity: 'Product',
                    });
                },
            );
    }
}
